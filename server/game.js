const { randomUUID } = require('crypto');
const { SKILLS } = require('./skills');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O, 1/I 제외
const MIN_PLAYERS = 2;
const DEFAULT_DURATION_SEC = 480; // 8분
const TUTORIAL_MIN_MS = 0;
const CALIBRATION_MS = 4000;
const COUNTDOWN_SEC = 5;

function makeRoomCode(existingCodes) {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (existingCodes.has(code));
  return code;
}

function freshSkillState(role) {
  const state = {};
  for (const skill of Object.values(SKILLS)) {
    if (skill.role !== role) continue;
    state[skill.id] = {
      chargesLeft: skill.maxCharges,
      lastUsedAt: 0
    };
  }
  return state;
}

class Room {
  constructor(code) {
    this.code = code;
    this.hostId = null; // playerId
    this.players = new Map(); // playerId -> player
    this.phase = 'lobby'; // lobby | tutorial | calibration | countdown | playing | ended
    this.calibStage = null; // 'ambient' | 'near'
    this.settings = { durationSec: DEFAULT_DURATION_SEC, sensitivity: 1.0 };
    this.tutorialAcked = new Set();
    this.tutorialSlide = 0; // 방장이 넘기면 전원 화면이 같이 넘어간다
    this.calibrationDone = new Set();
    this.chat = []; // 로비 채팅 기록 (늦게 들어온 사람도 볼 수 있게 최근 것만 보관)
    this.remainingSec = 0;
    this._interval = null;
    this.createdAt = Date.now();
    this.winner = null;
    this.winReason = null;
  }

  addPlayer(name) {
    const id = randomUUID();
    const player = {
      id,
      name: String(name || '이름없음').slice(0, 16),
      socketId: null,
      connected: true,
      role: null,
      alive: true,
      lastDanger: 0,
      skills: {}
    };
    this.players.set(id, player);
    if (!this.hostId) this.hostId = id;
    return player;
  }

  get playerList() {
    return [...this.players.values()];
  }

  get alivePlayers() {
    return this.playerList.filter(p => p.role === 'runner' && p.alive);
  }

  get seeker() {
    return this.playerList.find(p => p.role === 'seeker') || null;
  }

  publicState() {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      calibStage: this.calibStage,
      settings: this.settings,
      remainingSec: this.remainingSec,
      players: this.playerList.map(p => ({
        id: p.id,
        name: p.name,
        role: p.role,
        alive: p.alive,
        connected: p.connected
      }))
    };
  }

  canStart() {
    return this.phase === 'lobby' && this.playerList.length >= MIN_PLAYERS;
  }

  assignRoles() {
    const players = this.playerList;
    const seekerIdx = Math.floor(Math.random() * players.length);
    players.forEach((p, i) => {
      p.role = i === seekerIdx ? 'seeker' : 'runner';
      p.alive = true;
      p.lastDanger = 0;
      p.skills = freshSkillState(p.role);
    });
  }

  startTutorial() {
    this.phase = 'tutorial';
    this.tutorialAcked.clear();
    this.tutorialSlide = 0;
  }

  ackTutorial(playerId) {
    this.tutorialAcked.add(playerId);
  }

  get readyCount() {
    return this.playerList.filter(p => this.tutorialAcked.has(p.id)).length;
  }

  allReady() {
    return this.playerList.every(p => this.tutorialAcked.has(p.id) || !p.connected);
  }

  setTutorialSlide(index, slideCount) {
    this.tutorialSlide = Math.max(0, Math.min(slideCount - 1, index));
    return this.tutorialSlide;
  }

  addChat(player, text) {
    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      playerId: player.id,
      name: player.name,
      text: String(text).slice(0, 120),
      ts: Date.now()
    };
    this.chat.push(msg);
    if (this.chat.length > 60) this.chat.shift();
    return msg;
  }

  // 보정은 2단계로 진행한다.
  //  ambient: 비콘 끄고 방의 기본 소음 측정 (위험도 0 기준)
  //  near   : 술래 비콘을 켜고 다같이 모인 상태 측정 (위험도 100 기준)
  // 폰 스피커 음량/마이크 감도/방 크기가 제각각이라 절대 임계값은 쓸 수 없고,
  // 이 두 기준점 사이를 매핑해야 어느 환경에서든 게이지가 제대로 움직인다.
  startCalibration(stage) {
    this.phase = 'calibration';
    this.calibStage = stage;
    this.calibrationDone.clear();
  }

  ackCalibration(playerId) {
    this.calibrationDone.add(playerId);
    const runners = this.playerList.filter(p => p.role === 'runner');
    return runners.every(r => this.calibrationDone.has(r.id) || !r.connected);
  }

  startCountdown() {
    this.phase = 'countdown';
  }

  startPlaying(onTick, onTimeUp) {
    this.phase = 'playing';
    this.remainingSec = this.settings.durationSec;
    clearInterval(this._interval);
    this._interval = setInterval(() => {
      this.remainingSec -= 1;
      onTick(this.remainingSec);
      if (this.remainingSec <= 0) {
        clearInterval(this._interval);
        onTimeUp();
      }
    }, 1000);
  }

  stopTimer() {
    clearInterval(this._interval);
    this._interval = null;
  }

  endGame(winner, reason) {
    this.phase = 'ended';
    this.winner = winner;
    this.winReason = reason;
    this.stopTimer();
  }

  checkAllCaught() {
    return this.playerList.some(p => p.role === 'runner') &&
      this.playerList.filter(p => p.role === 'runner').every(p => !p.alive);
  }

  isEmpty() {
    return this.playerList.length === 0 || this.playerList.every(p => !p.connected);
  }
}

class GameManager {
  constructor() {
    this.rooms = new Map(); // code -> Room
  }

  createRoom() {
    const code = makeRoomCode(new Set(this.rooms.keys()));
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get(String(code || '').toUpperCase());
  }

  removeRoomIfEmpty(code) {
    const room = this.rooms.get(code);
    if (room && room.isEmpty()) {
      room.stopTimer();
      this.rooms.delete(code);
    }
  }
}

module.exports = { GameManager, Room, SKILLS, MIN_PLAYERS, CALIBRATION_MS, COUNTDOWN_SEC };
