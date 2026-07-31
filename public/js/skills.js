// 표시용 스킬 메타데이터. id/수치는 server/skills.js와 일치시켜야 함.
const SKILL_META = {
  smoke: {
    id: 'smoke', role: 'runner', icon: '💣', name: '연막탄',
    dangerThreshold: 50, maxCharges: 2,
    shortDesc: '위험도 50 넘으면 버튼 켜짐 · 2회',
    desc: '위험도가 50을 넘으면 버튼에 불이 들어와요. 누르면 <b>나 말고 다른 도망자 한 명의 폰에서 3초간 비명이 터집니다.</b> 술래는 그 소리로 달려가고, 나는 조용히 빠져나가면 됨. 누가 걸릴지는 랜덤.'
  },
  dive: {
    id: 'dive', role: 'runner', icon: '🫥', name: '잠수',
    dangerThreshold: 0, maxCharges: 1,
    shortDesc: '아무때나 · 1회 · 6초',
    desc: '조건 없이 아무때나 딱 1번. <b>6초 동안 절대 안 잡혀요.</b> 술래 손이 코앞까지 왔을 때 쓰는 마지막 카드.'
  },
  shriek: {
    id: 'shriek', role: 'seeker', icon: '👹', name: '괴성',
    dangerThreshold: 0, maxCharges: 1,
    shortDesc: '화면 1.5초 꾹 누르기 · 1회',
    desc: '조건 없이 아무때나 딱 1번. <b>모든 도망자 폰에서 동시에 비명이 터져요.</b> 사방에서 소리가 나니까 그 방향으로 <b>전원 위치가 한 번에 드러납니다.</b> 승부처에서 쓰세요.'
  }
};

const RUNNER_SKILL_IDS = ['smoke', 'dive'];
const SEEKER_SKILL_IDS = ['shriek'];
