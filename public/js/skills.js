// 표시용 스킬 메타데이터. id/수치는 server/skills.js와 일치시켜야 함.
const SKILL_META = {
  smoke: {
    id: 'smoke', role: 'runner', icon: '💨', name: '연막탄',
    dangerThreshold: 70, maxCharges: 2,
    shortDesc: '위험도 70+ 필요 · 2회',
    desc: '위험도가 70 이상일 때 사용 가능. 나 말고 무작위의 다른 도망자 폰에서 2초간 큰 소리가 나요. 술래의 청각을 다른 곳으로 돌리는 미끼예요.'
  },
  freeze: {
    id: 'freeze', role: 'runner', icon: '🫧', name: '숨죽이기',
    dangerThreshold: 0, maxCharges: 1,
    shortDesc: '언제든 · 1회',
    desc: '언제든 사용 가능. 8초간 절대 잡히지 않아요(무적) + 위험도 게이지가 그 순간에 고정돼요. 대신 지속 중엔 다른 스킬을 못 써요.'
  },
  warn: {
    id: 'warn', role: 'runner', icon: '📳', name: '경고 펄스',
    dangerThreshold: 0, maxCharges: Infinity, cooldownSec: 45,
    shortDesc: '45초마다 · 무제한',
    desc: '45초마다 재사용 가능, 횟수 제한 없음. 나를 포함한 모든 도망자 폰에 짧은 진동을 보내요. 위치 정보는 없지만 "누군가 위험하다"는 각성 신호예요.'
  },
  calm: {
    id: 'calm', role: 'runner', icon: '🫀', name: '심박 안정',
    dangerThreshold: 0, maxCharges: 1,
    shortDesc: '언제든 · 1회 · 15초',
    desc: '언제든 사용 가능. 15초간 내 위험도 상승 폭이 절반으로 줄어요. 위험 구간을 조용히 빠져나갈 때 쓰세요.'
  },
  shriek: {
    id: 'shriek', role: 'seeker', icon: '👹', name: '괴성',
    dangerThreshold: 0, maxCharges: 1,
    shortDesc: '게임당 1회',
    desc: '게임 중 1회. 모든 도망자의 폰에서 동시에 큰 비명이 나요. 다들 놀라서 반응하게 만드는 심리전용 스킬이에요.'
  }
};

const RUNNER_SKILL_IDS = ['smoke', 'freeze', 'warn', 'calm'];
const SEEKER_SKILL_IDS = ['shriek'];
