const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const { Server } = require('socket.io');

const { GameManager, SKILLS, MIN_PLAYERS, CALIBRATION_MS, COUNTDOWN_SEC } = require('./game');

// LAN_MODE=1: 파티 당일 노트북에서 직접 실행 (같은 와이파이, 자체서명 HTTPS 필요).
// 기본값(미설정): Render 등 클라우드 배포 - 플랫폼이 TLS를 대신 처리하므로 평범한 HTTP로 충분.
const LAN_MODE = process.env.LAN_MODE === '1';
const PORT = process.env.PORT || 8443;
const gm = new GameManager();

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

let server;
if (LAN_MODE) {
  const { ensureCert } = require('./gen-cert');
  const { key, cert } = ensureCert();
  server = https.createServer({ key, cert }, app);
} else {
  server = http.createServer(app);
}
const io = new Server(server, { cors: { origin: '*' } });

function localUrls() {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`${LAN_MODE ? 'https' : 'http'}://${net.address}:${PORT}`);
      }
    }
  }
  return urls;
}

function roomOf(socket) {
  const code = socket.data.roomCode;
  return code ? gm.getRoom(code) : null;
}

function playerOf(socket) {
  const room = roomOf(socket);
  if (!room) return null;
  return room.players.get(socket.data.playerId) || null;
}

function broadcastRoom(room) {
  io.to(room.code).emit('room:update', room.publicState());
}

function socketForPlayer(room, playerId) {
  const p = room.players.get(playerId);
  if (!p || !p.socketId) return null;
  return io.sockets.sockets.get(p.socketId) || null;
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ name }, cb) => {
    const room = gm.createRoom();
    const player = room.addPlayer(name);
    player.socketId = socket.id;
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
    cb({ ok: true, code: room.code, playerId: player.id });
    broadcastRoom(room);
  });

  socket.on('room:join', ({ code, name }, cb) => {
    const room = gm.getRoom(code);
    if (!room) return cb({ ok: false, error: '존재하지 않는 방 코드예요.' });
    if (room.phase !== 'lobby') return cb({ ok: false, error: '이미 시작된 게임이에요.' });
    const player = room.addPlayer(name);
    player.socketId = socket.id;
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
    cb({ ok: true, code: room.code, playerId: player.id });
    socket.emit('chat:history', room.chat);
    broadcastRoom(room);
  });

  socket.on('room:rejoin', ({ code, playerId }, cb) => {
    const room = gm.getRoom(code);
    if (!room || !room.players.has(playerId)) return cb({ ok: false, error: '재접속할 방을 찾지 못했어요.' });
    const player = room.players.get(playerId);
    player.socketId = socket.id;
    player.connected = true;
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
    cb({ ok: true, code: room.code, playerId: player.id, hostId: room.hostId, phase: room.phase, role: player.role, settings: room.settings, remainingSec: room.remainingSec });
    socket.emit('chat:history', room.chat);
    broadcastRoom(room);
  });

  socket.on('lobby:updateSettings', ({ durationSec, sensitivity }) => {
    const room = roomOf(socket);
    const player = playerOf(socket);
    if (!room || !player || room.hostId !== player.id || room.phase !== 'lobby') return;
    if (Number.isFinite(durationSec)) room.settings.durationSec = Math.max(60, Math.min(1800, durationSec));
    if (Number.isFinite(sensitivity)) room.settings.sensitivity = Math.max(0.3, Math.min(3, sensitivity));
    broadcastRoom(room);
  });

  socket.on('chat:send', ({ text }) => {
    const room = roomOf(socket);
    const player = playerOf(socket);
    if (!room || !player) return;
    const clean = String(text || '').trim();
    if (!clean) return;
    const now = Date.now();
    if (now - (socket.data.lastChatAt || 0) < 400) return; // 도배 방지
    socket.data.lastChatAt = now;
    io.to(room.code).emit('chat:msg', room.addChat(player, clean));
  });

  socket.on('lobby:start', () => {
    const room = roomOf(socket);
    const player = playerOf(socket);
    if (!room || !player || room.hostId !== player.id || !room.canStart()) return;
    room.assignRoles();
    room.startTutorial();
    for (const p of room.playerList) {
      const s = socketForPlayer(room, p.id);
      if (s) s.emit('phase:tutorial', { role: p.role, slide: 0 });
    }
    broadcastTutorial(room);
    broadcastRoom(room);
  });

  // 방장이 슬라이드를 넘기면 전원 화면이 같이 넘어간다 (다같이 보면서 설명하는 용도)
  socket.on('tutorial:goto', ({ index, slideCount }) => {
    const room = roomOf(socket);
    const player = playerOf(socket);
    if (!room || !player || room.hostId !== player.id || room.phase !== 'tutorial') return;
    if (!Number.isFinite(index) || !Number.isFinite(slideCount) || slideCount <= 0) return;
    room.setTutorialSlide(index, slideCount);
    broadcastTutorial(room);
  });

  // 각자 한 번은 화면을 눌러야 한다 (iOS는 사용자 제스처가 있어야 마이크/오디오가 열림)
  socket.on('tutorial:ack', () => {
    const room = roomOf(socket);
    const player = playerOf(socket);
    if (!room || !player || room.phase !== 'tutorial') return;
    room.ackTutorial(player.id);
    broadcastTutorial(room);
  });

  socket.on('tutorial:finish', () => {
    const room = roomOf(socket);
    const player = playerOf(socket);
    if (!room || !player || room.hostId !== player.id || room.phase !== 'tutorial') return;
    if (!room.allReady()) return;
    room.startCalibration('ambient');
    io.to(room.code).emit('phase:calibration', { stage: 'ambient', calibrationMs: CALIBRATION_MS });
    broadcastRoom(room);
  });

  socket.on('calibration:done', () => {
    const room = roomOf(socket);
    const player = playerOf(socket);
    if (!room || !player || room.phase !== 'calibration') return;
    if (player.role !== 'runner') return;
    const allDone = room.ackCalibration(player.id);
    if (!allDone) return;

    if (room.calibStage === 'ambient') {
      // 2단계: 술래 비콘을 켜고 "다같이 모인 상태"를 위험도 100 기준점으로 측정
      room.startCalibration('near');
      const seeker = room.seeker;
      if (seeker) {
        const s = socketForPlayer(room, seeker.id);
        if (s) s.emit('calibration:beaconOn');
      }
      io.to(room.code).emit('phase:calibration', { stage: 'near', calibrationMs: CALIBRATION_MS });
      broadcastRoom(room);
      return;
    }

    room.startCountdown();
    io.to(room.code).emit('phase:countdown', { seconds: COUNTDOWN_SEC });
    setTimeout(() => beginPlaying(room), COUNTDOWN_SEC * 1000);
    broadcastRoom(room);
  });

  socket.on('game:dangerUpdate', ({ danger }) => {
    const room = roomOf(socket);
    const player = playerOf(socket);
    if (!room || !player || room.phase !== 'playing' || player.role !== 'runner') return;
    if (Number.isFinite(danger)) player.lastDanger = Math.max(0, Math.min(100, danger));
  });

  socket.on('game:adjustSensitivity', ({ value }) => {
    const room = roomOf(socket);
    const player = playerOf(socket);
    if (!room || !player || room.hostId !== player.id || room.phase !== 'playing') return;
    room.settings.sensitivity = Math.max(0.3, Math.min(3, value));
    io.to(room.code).emit('game:sensitivity', { sensitivity: room.settings.sensitivity });
  });

  socket.on('game:useSkill', ({ skillId }, cb) => {
    const ack = cb || (() => {});
    const room = roomOf(socket);
    const player = playerOf(socket);
    if (!room || !player || room.phase !== 'playing') return ack({ ok: false, error: '지금은 사용할 수 없어요.' });
    const def = SKILLS[skillId];
    if (!def || def.role !== player.role) return ack({ ok: false, error: '사용할 수 없는 스킬이에요.' });
    if (player.role === 'runner' && !player.alive) return ack({ ok: false, error: '이미 잡혔어요.' });

    const state = player.skills[skillId];
    if (!state || state.chargesLeft <= 0) return ack({ ok: false, error: '남은 사용 횟수가 없어요.' });
    const now = Date.now();
    if (def.cooldownMs && now - state.lastUsedAt < def.cooldownMs) {
      return ack({ ok: false, error: '아직 재사용 대기 중이에요.' });
    }
    if (def.dangerThreshold && player.lastDanger < def.dangerThreshold) {
      return ack({ ok: false, error: `위험도 ${def.dangerThreshold} 이상일 때 사용 가능해요.` });
    }
    if (def.dangerMax != null && player.lastDanger > def.dangerMax) {
      return ack({ ok: false, error: `위험도 ${def.dangerMax} 이하일 때만 쓸 수 있어요. 지금은 너무 가까워요!` });
    }

    const result = applySkillEffect(room, player, def);
    if (!result.ok) return ack(result);

    state.chargesLeft = Number.isFinite(state.chargesLeft) ? state.chargesLeft - 1 : state.chargesLeft;
    state.lastUsedAt = now;
    ack({ ok: true, chargesLeft: state.chargesLeft });
  });

  // 술래가 화면을 탭 = "잡았다!" 시도. 안대 때문에 화면을 볼 수 없으므로
  // 화면 전체가 하나의 버튼이고, 도망자들에게는 진동으로만 전달된다.
  socket.on('game:tagAttempt', () => {
    const room = roomOf(socket);
    const player = playerOf(socket);
    if (!room || !player || room.phase !== 'playing' || player.role !== 'seeker') return;
    const now = Date.now();
    if (now - (socket.data.lastTagAttempt || 0) < 1500) return; // 연타 방지
    socket.data.lastTagAttempt = now;
    for (const runner of room.alivePlayers) {
      const s = socketForPlayer(room, runner.id);
      if (s) s.emit('game:tensionPulse');
    }
  });

  socket.on('game:confirmCaught', (_, cb) => {
    const ack = cb || (() => {});
    const room = roomOf(socket);
    const player = playerOf(socket);
    if (!room || !player || room.phase !== 'playing' || player.role !== 'runner') return ack({ ok: false });
    if (!player.alive) return ack({ ok: false });
    // 항복은 무엇으로도 막을 수 없다. 붙잡힌 본인이 인정하면 그대로 탈락.
    player.alive = false;
    ack({ ok: true });
    io.to(room.code).emit('game:playerCaught', { playerId: player.id, name: player.name });
    broadcastRoom(room);
    if (room.checkAllCaught()) {
      room.endGame('seeker', '모든 도망자가 잡혔어요');
      io.to(room.code).emit('game:over', { winner: 'seeker', reason: room.winReason, players: resultPlayers(room) });
    }
  });

  socket.on('lobby:rematch', () => {
    const room = roomOf(socket);
    const player = playerOf(socket);
    if (!room || !player || room.hostId !== player.id || room.phase !== 'ended') return;
    room.stopTimer();
    room.phase = 'lobby';
    room.tutorialAcked.clear();
    room.calibrationDone.clear();
    room.winner = null;
    room.winReason = null;
    for (const p of room.playerList) {
      p.role = null;
      p.alive = true;
      p.lastDanger = 0;
      p.skills = {};
    }
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    const room = roomOf(socket);
    const player = playerOf(socket);
    if (!room || !player) return;
    player.connected = false;
    broadcastRoom(room);
    // 전원이 나갔을 때만 정리됨(isEmpty) - 한 명이라도 연결돼 있으면 재접속 여지를 위해 유지
    gm.removeRoomIfEmpty(room.code);
  });
});

function broadcastTutorial(room) {
  io.to(room.code).emit('tutorial:state', {
    slide: room.tutorialSlide,
    readyCount: room.readyCount,
    total: room.playerList.filter(p => p.connected).length,
    allReady: room.allReady(),
    readyIds: [...room.tutorialAcked]
  });
}

function resultPlayers(room) {
  return room.playerList.map(p => ({ id: p.id, name: p.name, role: p.role, alive: p.alive }));
}

function applySkillEffect(room, player, def) {
  switch (def.effect) {
    case 'noiseOnRandomOther': {
      const others = room.alivePlayers.filter(p => p.id !== player.id);
      if (others.length === 0) return { ok: false, error: '대상이 될 다른 도망자가 없어요.' };
      const target = others[Math.floor(Math.random() * others.length)];
      const s = socketForPlayer(room, target.id);
      if (s) s.emit('game:playEffect', { effect: 'noise', durationMs: def.effectMs });
      return { ok: true };
    }
    case 'noiseOnSeeker': {
      const seeker = room.seeker;
      if (!seeker) return { ok: false, error: '술래가 없어요.' };
      const s = socketForPlayer(room, seeker.id);
      if (s) s.emit('game:playEffect', { effect: 'noise', durationMs: def.effectMs });
      return { ok: true };
    }
    case 'noiseOnAllRunners': {
      for (const p of room.alivePlayers) {
        const s = socketForPlayer(room, p.id);
        if (s) s.emit('game:playEffect', { effect: 'noise', durationMs: def.effectMs });
      }
      return { ok: true };
    }
    default:
      return { ok: false, error: '알 수 없는 효과예요.' };
  }
}

function beginPlaying(room) {
  if (room.phase !== 'countdown') return;
  room.startPlaying(
    (remainingSec) => io.to(room.code).emit('game:tick', { remainingSec }),
    () => {
      room.endGame('runners', '제한 시간 종료까지 생존');
      io.to(room.code).emit('game:over', { winner: 'runners', reason: room.winReason, players: resultPlayers(room) });
    }
  );
  for (const p of room.playerList) {
    const s = socketForPlayer(room, p.id);
    if (s) s.emit('phase:playing', { durationSec: room.settings.durationSec, sensitivity: room.settings.sensitivity, role: p.role });
  }
  broadcastRoom(room);
}

server.listen(PORT, () => {
  console.log(`\n공포 술래잡기 서버 시작! (${LAN_MODE ? 'LAN 모드' : '클라우드/프록시 모드'})`);
  if (LAN_MODE) {
    console.log(`같은 와이파이에 연결된 폰에서 아래 주소로 접속하세요:\n`);
    const urls = localUrls();
    if (urls.length === 0) {
      console.log(`  https://localhost:${PORT} (네트워크 인터페이스를 찾지 못했어요)`);
    } else {
      urls.forEach(u => console.log(`  ${u}`));
    }
    console.log(`\n처음 접속하면 "안전하지 않음" 경고가 뜨는데, 자체 서명 인증서라서 그래요.`);
    console.log(`(크롬: 고급 > 이동, 사파리: 자세히 보기 > 이 웹 사이트 방문) 눌러서 진행하면 됩니다.\n`);
  } else {
    console.log(`포트 ${PORT}에서 대기 중 (플랫폼이 제공하는 공개 HTTPS 주소로 접속하세요).\n`);
  }
});
