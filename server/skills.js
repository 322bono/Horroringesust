// 서버 권위(authoritative) 스킬 정의. 클라이언트 public/js/skills.js(표시용 텍스트)와 id/수치를 맞출 것.
//
// 설계 원칙
//  - 어두운 방에서 화면 보며 조건을 외울 수 없다. 스킬은 적고 조건은 한 줄이어야 한다.
//  - 무적/보호 같은 판정 방해 기능은 없다. 붙잡히면 "항복!!" 외치고 그냥 탈락이다.
//  - 모든 스킬은 "어둠 속에서 누군가의 폰을 비명지르게 만든다"는 한 가지 규칙만 쓴다.
//  - 두 도망자 스킬은 정반대 상황에서 열린다. 위험할 때 쓰는 것(연막탄) /
//    안전할 때만 쓰는 것(귀신소리). 그래야 둘 다 쓰이고 판단할 거리가 생긴다.
const SKILLS = {
  smoke: {
    id: 'smoke',
    role: 'runner',
    maxCharges: 2,
    cooldownMs: 0,
    dangerThreshold: 50, // 위험도 50 이상에서만 (쫓길 때 쓰는 반격기)
    dangerMax: null,
    effect: 'noiseOnRandomOther',
    effectMs: 3000
  },
  ghost: {
    id: 'ghost',
    role: 'runner',
    maxCharges: 1,
    cooldownMs: 0,
    dangerThreshold: 0,
    dangerMax: 30, // 위험도 30 이하에서만 (멀리서 몰래 지르는 도발기)
    effect: 'noiseOnSeeker',
    effectMs: 3000
  },
  shriek: {
    id: 'shriek',
    role: 'seeker',
    maxCharges: 1,
    cooldownMs: 0,
    dangerThreshold: 0,
    dangerMax: null,
    effect: 'noiseOnAllRunners',
    effectMs: 3000
  }
};

module.exports = { SKILLS };
