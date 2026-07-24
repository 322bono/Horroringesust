// 서버 권위(authoritative) 스킬 정의. 클라이언트의 public/js/skills.js(표시용 텍스트)와 id/수치를 맞춰서 유지할 것.
const SKILLS = {
  smoke: {
    id: 'smoke',
    role: 'runner',
    maxCharges: 2,
    cooldownMs: 0,
    dangerThreshold: 70, // 위험도 70 이상일 때만 사용 가능
    effect: 'noiseOnRandomOther',
    effectMs: 2200
  },
  freeze: {
    id: 'freeze',
    role: 'runner',
    maxCharges: 1,
    cooldownMs: 0,
    dangerThreshold: 0,
    effect: 'tagImmunity',
    effectMs: 8000
  },
  warn: {
    id: 'warn',
    role: 'runner',
    maxCharges: Infinity,
    cooldownMs: 45000,
    dangerThreshold: 0,
    effect: 'vibrateAllRunners',
    effectMs: 0
  },
  calm: {
    id: 'calm',
    role: 'runner',
    maxCharges: 1,
    cooldownMs: 0,
    dangerThreshold: 0,
    effect: 'dampenSensitivity',
    effectMs: 15000
  },
  shriek: {
    id: 'shriek',
    role: 'seeker',
    maxCharges: 1,
    cooldownMs: 0,
    dangerThreshold: 0,
    effect: 'noiseOnAllRunners',
    effectMs: 2200
  }
};

module.exports = { SKILLS };
