// 서버 권위(authoritative) 스킬 정의. 클라이언트 public/js/skills.js(표시용 텍스트)와 id/수치를 맞출 것.
//
// 설계 원칙: 어두운 방에서 화면 보며 조건을 외울 수 없다. 스킬은 적고, 조건은 한 줄로 설명되고,
// 효과는 즉각적이고 시끄러워야 한다. 모든 스킬이 "어둠 속 소리 조작"이라는 하나의 규칙으로 묶인다.
const SKILLS = {
  smoke: {
    id: 'smoke',
    role: 'runner',
    maxCharges: 2,
    cooldownMs: 0,
    dangerThreshold: 50, // 위험도 50 이상에서만 - "위험할 때만 쓸 수 있는 반격기"
    effect: 'noiseOnRandomOther',
    effectMs: 3000
  },
  dive: {
    id: 'dive',
    role: 'runner',
    maxCharges: 1,
    cooldownMs: 0,
    dangerThreshold: 0,
    effect: 'tagImmunity',
    effectMs: 6000
  },
  shriek: {
    id: 'shriek',
    role: 'seeker',
    maxCharges: 1,
    cooldownMs: 0,
    dangerThreshold: 0,
    effect: 'noiseOnAllRunners',
    effectMs: 3000
  }
};

module.exports = { SKILLS };
