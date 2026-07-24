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
    this.settings = { durationSec: DEFAULT_DURATION_SEC, sensitivity: 1.0 };
    this.tutorialAcked = new Set();
    this.calibrationDone = new Set();
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
      immuneUntil: 0,
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
      p.immuneUntil = 0;
      p.lastDanger = 0;
      p.skills = freshSkillState(p.role);
    });
  }

  startTutorial() {
    this.phase = 'tutorial';
    this.tutorialAcked.clear();
  }

  ackTutorial(playerId) {
    this.tutorialAcked.add(playerId);
    return this.playerList.every(p => this.tutorialAcked.has(p.id) || !p.connected);
  }

  startCalibration() {
    this.phase = 'calibration';
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
