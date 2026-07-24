(() => {
  const socket = io();

  // ---------- DOM ----------
  const views = {
    home: document.getElementById('view-home'),
    lobby: document.getElementById('view-lobby'),
    tutorial: document.getElementById('view-tutorial'),
    calibration: document.getElementById('view-calibration'),
    countdown: document.getElementById('view-countdown'),
    'playing-runner': document.getElementById('view-playing-runner'),
    'playing-seeker': document.getElementById('view-playing-seeker'),
    results: document.getElementById('view-results')
  };
  function showView(name) {
    Object.values(views).forEach(v => v.hidden = true);
    views[name].hidden = false;
  }

  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
  }

  const flashEl = document.getElementById('flash-overlay');
  function flashScreen() {
    flashEl.classList.add('on');
    setTimeout(() => flashEl.classList.remove('on'), 150);
  }

  // ---------- state ----------
  let myPlayerId = null;
  let myRoomCode = null;
  let myRole = null;
  let isHost = false;
  let latestSettings = { durationSec: 480, sensitivity: 1.0 };

  // 위험도 계산 상태
  let noiseFloor = 0;
  let emaRMS = 0;
  let dangerLoopHandle = null;
  let dampenUntil = 0;
  let immuneUntilLocal = 0;
  let freezeActiveUntil = 0;
  let lastDisplayedDanger = 0;
  const EMA_ALPHA = 0.35;
  const SENSITIVITY_RANGE = 0.18;

  let skillCharges = {};
  let stopShake = null;
  let micStarted = false;

  // ---------- session persistence (새로고침/재접속 대비) ----------
  function saveSession(code, playerId) {
    try { sessionStorage.setItem('horrorTag', JSON.stringify({ code, playerId })); } catch (e) {}
  }
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem('horrorTag') || 'null'); } catch (e) { return null; }
  }
  function clearSession() {
    try { sessionStorage.removeItem('horrorTag'); } catch (e) {}
  }

  // ---------- 홈 화면 ----------
  const inputName = document.getElementById('input-name');
  const inputCode = document.getElementById('input-code');
  inputCode.addEventListener('input', () => { inputCode.value = inputCode.value.toUpperCase(); });

  document.getElementById('btn-create').addEventListener('click', () => {
    const name = inputName.value.trim();
    if (!name) return toast('닉네임을 입력하세요');
    socket.emit('room:create', { name }, (res) => {
      if (!res.ok) return toast(res.error || '방 생성 실패');
      onJoinedRoom(res.code, res.playerId);
    });
  });

  document.getElementById('btn-join').addEventListener('click', () => {
    const name = inputName.value.trim();
    const code = inputCode.value.trim().toUpperCase();
    if (!name) return toast('닉네임을 입력하세요');
    if (code.length !== 4) return toast('방 코드 4자리를 입력하세요');
    socket.emit('room:join', { code, name }, (res) => {
      if (!res.ok) return toast(res.error || '참가 실패');
      onJoinedRoom(res.code, res.playerId);
    });
  });

  function onJoinedRoom(code, playerId) {
    myRoomCode = code;
    myPlayerId = playerId;
    saveSession(code, playerId);
    showView('lobby');
  }

  // ---------- 로비 ----------
  const roomCodeEl = document.getElementById('room-code');
  const playerListEl = document.getElementById('player-list');
  const hostSettingsEl = document.getElementById('host-settings');
  const lobbyWaitMsgEl = document.getElementById('lobby-wait-msg');
  const btnStart = document.getElementById('btn-start');
  const inputDuration = document.getElementById('input-duration');
  const inputSensitivity = document.getElementById('input-sensitivity');
  const durationDisplay = document.getElementById('duration-display');
  const sensitivityDisplay = document.getElementById('sensitivity-display');

  inputDuration.addEventListener('input', () => {
    durationDisplay.textContent = `${inputDuration.value}분`;
    if (isHost) socket.emit('lobby:updateSettings', { durationSec: Number(inputDuration.value) * 60 });
  });
  inputSensitivity.addEventListener('input', () => {
    sensitivityDisplay.textContent = `${Number(inputSensitivity.value).toFixed(1)}x`;
    if (isHost) socket.emit('lobby:updateSettings', { sensitivity: Number(inputSensitivity.value) });
  });
  btnStart.addEventListener('click', () => socket.emit('lobby:start'));

  function renderLobbyList(players) {
    playerListEl.innerHTML = '';
    players.forEach(p => {
      const li = document.createElement('li');
      if (!p.connected) li.classList.add('offline');
      li.innerHTML = `<span>${p.id === latestHostId ? '👑 ' : ''}${escapeHtml(p.name)}</span><span class="tag">${p.connected ? '' : '연결 끊김'}</span>`;
      playerListEl.appendChild(li);
    });
  }

  let latestHostId = null;

  socket.on('room:update', (state) => {
    latestHostId = state.hostId;
    latestSettings = state.settings;
    isHost = state.hostId === myPlayerId;
    if (state.phase === 'lobby') {
      roomCodeEl.textContent = state.code;
      renderLobbyList(state.players);
      hostSettingsEl.hidden = !isHost;
      lobbyWaitMsgEl.hidden = isHost;
      if (isHost) {
        btnStart.disabled = state.players.length < 2;
        btnStart.textContent = state.players.length < 2 ? '게임 시작 (최소 2명)' : `게임 시작 (${state.players.length}명)`;
        inputDuration.value = Math.round(state.settings.durationSec / 60);
        durationDisplay.textContent = `${inputDuration.value}분`;
        inputSensitivity.value = state.settings.sensitivity;
        sensitivityDisplay.textContent = `${Number(state.settings.sensitivity).toFixed(1)}x`;
      }
      showView('lobby');
    }
  });

  // ---------- 튜토리얼 ----------
  const myRoleBanner = document.getElementById('my-role-banner');
  const skillsExplainRunner = document.getElementById('skills-explain-runner');
  const skillsExplainSeeker = document.getElementById('skills-explain-seeker');
  const btnTutorialAck = document.getElementById('btn-tutorial-ack');
  const tutorialWaitMsg = document.getElementById('tutorial-wait-msg');

  function renderSkillExplain(container, ids) {
    container.innerHTML = ids.map(id => {
      const m = SKILL_META[id];
      return `<div class="skill-explain-item"><span class="name">${m.icon} ${m.name} <span class="tag">(${m.shortDesc})</span></span><div class="desc">${m.desc}</div></div>`;
    }).join('');
  }

  socket.on('phase:tutorial', async ({ role }) => {
    myRole = role;
    myRoleBanner.textContent = `역할: ${role === 'seeker' ? '👁️ 술래' : '🏃 도망자'}`;
    renderSkillExplain(skillsExplainRunner, RUNNER_SKILL_IDS);
    renderSkillExplain(skillsExplainSeeker, SEEKER_SKILL_IDS);
    btnTutorialAck.disabled = false;
    btnTutorialAck.textContent = '이해했어요, 준비 완료';
    tutorialWaitMsg.hidden = true;
    showView('tutorial');
  });

  btnTutorialAck.addEventListener('click', async () => {
    // 사용자 제스처(클릭) 안에서 권한 요청을 걸어야 iOS에서 확실히 동작함
    if (myRole === 'seeker') {
      await HorrorAudio.requestMotionPermission();
    } else {
      await ensureMicStarted();
    }
    btnTutorialAck.disabled = true;
    btnTutorialAck.textContent = '준비 완료!';
    tutorialWaitMsg.hidden = false;
    socket.emit('tutorial:ack');
  });

  async function ensureMicStarted() {
    if (micStarted) return true;
    try {
      await HorrorAudio.startMic();
      micStarted = true;
      return true;
    } catch (e) {
      toast('마이크 권한이 필요해요! 브라우저 설정에서 허용해주세요.');
      return false;
    }
  }

  // ---------- 캘리브레이션 ----------
  const calibrationProgress = document.getElementById('calibration-progress');
  const calibrationTitle = document.getElementById('calibration-title');

  socket.on('phase:calibration', async ({ calibrationMs }) => {
    showView('calibration');
    calibrationProgress.style.width = '0%';

    if (myRole !== 'runner') {
      calibrationTitle.textContent = '안대를 착용해주세요';
      return;
    }

    const ok = await ensureMicStarted();
    if (!ok) {
      calibrationTitle.textContent = '마이크 권한을 확인해주세요!';
      // 그래도 진행은 시켜야 하니 서버엔 done 신호를 보냄 (권한 없으면 위험도 항상 0으로 표시됨)
      socket.emit('calibration:done');
      return;
    }

    calibrationTitle.textContent = '주변 소음 측정 중...';
    const samples = [];
    const start = Date.now();
    const iv = setInterval(() => {
      samples.push(HorrorAudio.sampleMicRMS());
      const elapsed = Date.now() - start;
      calibrationProgress.style.width = `${Math.min(100, (elapsed / calibrationMs) * 100)}%`;
      if (elapsed >= calibrationMs) {
        clearInterval(iv);
        noiseFloor = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
        socket.emit('calibration:done');
      }
    }, 100);
  });

  // ---------- 카운트다운 ----------
  const countdownNumberEl = document.getElementById('countdown-number');
  socket.on('phase:countdown', ({ seconds }) => {
    showView('countdown');
    let n = seconds;
    countdownNumberEl.textContent = n;
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(iv); return; }
      countdownNumberEl.textContent = n;
    }, 1000);
  });

  // ---------- 게임 진행 ----------
  const runnerTimerEl = document.getElementById('runner-timer');
  const seekerTimerEl = document.getElementById('seeker-timer');
  const runnerStatusEl = document.getElementById('runner-status');
  const dangerGaugeEl = document.getElementById('danger-gauge');
  const dangerPercentEl = document.getElementById('danger-percent');
  const skillButtonsRunnerEl = document.getElementById('skill-buttons-runner');
  const btnCaught = document.getElementById('btn-caught');
  const btnShriek = document.getElementById('btn-shriek');
  const btnShakeManual = document.getElementById('btn-shake-manual');

  function formatTime(sec) {
    const m = Math.max(0, Math.floor(sec / 60));
    const s = Math.max(0, Math.floor(sec % 60));
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  socket.on('phase:playing', ({ durationSec, sensitivity, role }) => {
    myRole = role;
    latestSettings.sensitivity = sensitivity;
    HorrorAudio.requestWakeLock();
    runnerTimerEl.textContent = formatTime(durationSec);
    seekerTimerEl.textContent = formatTime(durationSec);

    if (role === 'seeker') {
      showView('playing-seeker');
      HorrorAudio.startBeacon();
      initSkillState('seeker');
      wireSeekerControls();
    } else {
      showView('playing-runner');
      runnerStatusEl.textContent = '생존 중';
      runnerStatusEl.classList.remove('caught');
      initSkillState('runner');
      renderRunnerSkillButtons();
      startDangerLoop(sensitivity);
    }
  });

  socket.on('game:tick', ({ remainingSec }) => {
    runnerTimerEl.textContent = formatTime(remainingSec);
    seekerTimerEl.textContent = formatTime(remainingSec);
  });

  socket.on('game:sensitivity', ({ sensitivity }) => {
    latestSettings.sensitivity = sensitivity;
  });

  socket.on('game:playEffect', ({ effect, durationMs }) => {
    if (effect === 'noise') {
      HorrorAudio.playScream(durationMs);
      HorrorAudio.vibrate([300, 100, 300]);
      flashScreen();
    } else if (effect === 'vibrate') {
      HorrorAudio.vibrate([200, 100, 200]);
    } else if (effect === 'immunity') {
      immuneUntilLocal = Date.now() + durationMs;
      freezeActiveUntil = immuneUntilLocal;
      runnerStatusEl.textContent = '🫧 무적!';
      toast('숨죽이기 활성! 8초간 잡히지 않아요');
      setTimeout(() => {
        if (Date.now() >= immuneUntilLocal - 50) runnerStatusEl.textContent = '생존 중';
      }, durationMs + 50);
    } else if (effect === 'dampen') {
      dampenUntil = Date.now() + durationMs;
      toast('심박 안정 활성! 15초간 위험도 상승 둔화');
    }
  });

  socket.on('game:tensionPulse', () => {
    HorrorAudio.vibrate([80, 60, 80, 60, 200]);
  });

  socket.on('game:playerCaught', ({ playerId, name }) => {
    if (playerId === myPlayerId) {
      runnerStatusEl.textContent = '😵 잡힘';
      runnerStatusEl.classList.add('caught');
      teardownRunnerLoop();
    } else {
      toast(`${name}님이 잡혔어요!`);
    }
  });

  socket.on('game:over', ({ winner, reason, players }) => {
    teardownAllLoops();
    showResults(winner, reason, players);
  });

  // ---- 위험도 루프 (도망자) ----
  function startDangerLoop(sensitivity) {
    emaRMS = noiseFloor;
    lastDisplayedDanger = 0;
    clearInterval(dangerLoopHandle);
    let lastHapticAt = 0;
    dangerLoopHandle = setInterval(() => {
      const now = Date.now();
      const raw = HorrorAudio.sampleMicRMS();
      emaRMS = emaRMS * (1 - EMA_ALPHA) + raw * EMA_ALPHA;
      const above = Math.max(0, emaRMS - noiseFloor);

      let factor = latestSettings.sensitivity || sensitivity || 1;
      if (now < dampenUntil) factor *= 0.5;

      let danger = Math.min(100, (above / SENSITIVITY_RANGE) * 100 * factor);
      if (now < immuneUntilLocal) danger = lastDisplayedDanger; // 숨죽이기 중엔 게이지 고정

      lastDisplayedDanger = danger;
      renderDanger(danger);
      socket.emit('game:dangerUpdate', { danger });
      updateSkillButtonStates(danger);

      if (danger >= 70 && now - lastHapticAt > 900) { HorrorAudio.vibrate(120); lastHapticAt = now; }
      else if (danger >= 35 && now - lastHapticAt > 2500) { HorrorAudio.vibrate(60); lastHapticAt = now; }
    }, 150);
  }

  function renderDanger(danger) {
    const pct = Math.round(danger);
    dangerPercentEl.textContent = pct;
    const deg = pct * 3.6;
    let color = 'var(--safe)', lvl = 'lvl-safe';
    if (pct >= 70) { color = 'var(--danger)'; lvl = 'lvl-danger'; }
    else if (pct >= 35) { color = 'var(--warn)'; lvl = 'lvl-warn'; }
    dangerGaugeEl.style.background = `conic-gradient(${color} ${deg}deg, #241416 ${deg}deg)`;
    dangerGaugeEl.className = 'danger-gauge ' + lvl;
  }

  // ---- 스킬 버튼 ----
  function initSkillState(role) {
    const ids = role === 'seeker' ? SEEKER_SKILL_IDS : RUNNER_SKILL_IDS;
    skillCharges = {};
    ids.forEach(id => { skillCharges[id] = { left: SKILL_META[id].maxCharges, readyAt: 0 }; });
    freezeActiveUntil = 0;
  }

  function chargesLabel(id) {
    const st = skillCharges[id];
    if (!st) return '';
    return st.left === Infinity ? '무제한' : `${st.left}회 남음`;
  }

  function renderRunnerSkillButtons() {
    skillButtonsRunnerEl.innerHTML = RUNNER_SKILL_IDS.map(id => {
      const m = SKILL_META[id];
      return `<button class="skill-btn" id="skill-${id}" disabled>
        <span class="icon">${m.icon}</span>
        <span class="name">${m.name}</span>
        <span class="charges" id="charges-${id}">${chargesLabel(id)}</span>
      </button>`;
    }).join('');
    RUNNER_SKILL_IDS.forEach(id => {
      document.getElementById(`skill-${id}`).addEventListener('click', () => useSkill(id));
    });
    updateSkillButtonStates(0);
  }

  function updateSkillButtonStates(danger) {
    const now = Date.now();
    const frozen = now < freezeActiveUntil;
    RUNNER_SKILL_IDS.forEach(id => {
      const btn = document.getElementById(`skill-${id}`);
      if (!btn) return;
      const meta = SKILL_META[id];
      const st = skillCharges[id];
      const hasCharge = st.left > 0;
      const offCooldown = now >= st.readyAt;
      const meetsThreshold = danger >= meta.dangerThreshold;
      const usable = !frozen && hasCharge && offCooldown && meetsThreshold;
      btn.disabled = !usable;
      btn.classList.toggle('ready', usable);
    });
  }

  function useSkill(id) {
    socket.emit('game:useSkill', { skillId: id }, (res) => {
      if (!res.ok) return toast(res.error || '사용 실패');
      const meta = SKILL_META[id];
      const st = skillCharges[id];
      if (Number.isFinite(st.left)) st.left = Math.max(0, st.left - 1);
      if (meta.cooldownSec) st.readyAt = Date.now() + meta.cooldownSec * 1000;
      const chargesEl = document.getElementById(`charges-${id}`);
      if (chargesEl) chargesEl.textContent = chargesLabel(id);

      if (id === 'smoke') toast('💨 연막탄 사용! 다른 도망자 폰이 곧 시끄러워질 거예요');
      if (id === 'warn') toast('📳 경고 펄스 발송!');
      if (id === 'shriek') { btnShriek.disabled = true; toast('👹 괴성 발동!'); }
      // freeze(숨죽이기)의 무적 지속시간은 서버가 보내는 game:playEffect(immunity)에서 설정됨
    });
  }

  // ---- 도망자: 잡힘 확인 ----
  btnCaught.addEventListener('click', () => {
    socket.emit('game:confirmCaught', {}, (res) => {
      if (res && res.ok === false && res.error) toast(res.error);
    });
  });

  // ---- 술래 컨트롤 ----
  function wireSeekerControls() {
    if (stopShake) stopShake();
    stopShake = HorrorAudio.onShake(() => socket.emit('game:shake'));
    btnShriek.disabled = false;
    btnShriek.onclick = () => useSkill('shriek');
    btnShakeManual.onclick = () => socket.emit('game:shake');
  }

  // ---- 정리 ----
  function teardownRunnerLoop() {
    clearInterval(dangerLoopHandle);
    dangerLoopHandle = null;
  }

  function teardownAllLoops() {
    teardownRunnerLoop();
    HorrorAudio.stopBeacon();
    HorrorAudio.stopMic();
    HorrorAudio.releaseWakeLock();
    micStarted = false;
    if (stopShake) { stopShake(); stopShake = null; }
  }

  // ---------- 결과 ----------
  const resultTitleEl = document.getElementById('result-title');
  const resultReasonEl = document.getElementById('result-reason');
  const resultListEl = document.getElementById('result-list');
  const btnReplay = document.getElementById('btn-replay');
  const replayWaitMsg = document.getElementById('replay-wait-msg');

  function showResults(winner, reason, players) {
    resultTitleEl.textContent = winner === 'seeker' ? '👹 술래 승리!' : '🏃 도망자 승리!';
    resultReasonEl.textContent = reason || '';
    resultListEl.innerHTML = '';
    (players || []).forEach(p => {
      const li = document.createElement('li');
      const roleLabel = p.role === 'seeker' ? '👁️ 술래' : (p.alive ? '🏃 생존' : '😵 잡힘');
      li.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="tag">${roleLabel}</span>`;
      resultListEl.appendChild(li);
    });
    btnReplay.hidden = !isHost;
    replayWaitMsg.hidden = isHost;
    showView('results');
  }

  btnReplay.addEventListener('click', () => {
    socket.emit('lobby:rematch');
  });

  // ---------- 재접속 ----------
  const saved = loadSession();
  if (saved && saved.code && saved.playerId) {
    socket.emit('room:rejoin', { code: saved.code, playerId: saved.playerId }, (res) => {
      if (!res.ok) { clearSession(); return; }
      myRoomCode = res.code;
      myPlayerId = res.playerId;
      myRole = res.role;
      isHost = res.hostId === myPlayerId;
      latestSettings = res.settings || latestSettings;
      if (res.phase === 'playing') {
        HorrorAudio.requestWakeLock();
        if (res.role === 'seeker') {
          showView('playing-seeker');
          HorrorAudio.startBeacon();
          initSkillState('seeker');
          wireSeekerControls();
        } else {
          showView('playing-runner');
          initSkillState('runner');
          renderRunnerSkillButtons();
          ensureMicStarted().then(() => startDangerLoop(latestSettings.sensitivity));
        }
        runnerTimerEl.textContent = formatTime(res.remainingSec);
        seekerTimerEl.textContent = formatTime(res.remainingSec);
      } else if (res.phase === 'lobby') {
        showView('lobby');
      } else {
        // 튜토리얼/캘리브레이션/카운트다운/종료 중 새로고침한 경우: 로비로 안내
        showView('lobby');
        toast('게임 중간에 재접속했어요. 진행 상황에 맞게 곧 화면이 바뀔 거예요.');
      }
    });
  }

  socket.on('connect_error', () => toast('서버 연결에 문제가 있어요. 와이파이를 확인하세요.'));

  // ---------- 유틸 ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  ['input-name', 'input-code'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (id === 'input-code') document.getElementById('btn-join').click();
        else document.getElementById('btn-create').click();
      }
    });
  });
})();
