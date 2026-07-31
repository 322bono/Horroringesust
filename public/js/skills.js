// 표시용 스킬 메타데이터. id/수치는 server/skills.js와 일치시켜야 함.
const SKILL_META = {
  smoke: {
    id: 'smoke', role: 'runner', icon: '💣', name: '연막탄',
    dangerThreshold: 50, dangerMax: null, maxCharges: 2,
    shortDesc: '위험도 50 이상일 때 · 2회',
    when: '쫓길 때',
    desc: '위험도가 50을 넘으면 버튼에 불이 들어와요. 누르면 <b>나 말고 다른 도망자 한 명의 폰에서 비명이 터집니다.</b> 술래가 그쪽으로 달려가는 사이에 튀면 됨. 누가 걸릴지는 랜덤.'
  },
  ghost: {
    id: 'ghost', role: 'runner', icon: '👻', name: '귀신소리',
    dangerThreshold: 0, dangerMax: 30, maxCharges: 1,
    shortDesc: '위험도 30 이하일 때 · 1회',
    when: '안전할 때',
    desc: '술래가 <b>멀리 있을 때만</b> 쓸 수 있어요. <b>술래 폰에서 비명이 터집니다.</b> 안대 쓴 술래를 놀래키고, 그 소리로 <b>술래 위치가 모두에게 드러나요.</b> 가까이 있으면 못 씁니다.'
  },
  shriek: {
    id: 'shriek', role: 'seeker', icon: '👹', name: '괴성',
    dangerThreshold: 0, dangerMax: null, maxCharges: 1,
    shortDesc: '화면 1.5초 꾹 · 1회',
    when: '아무때나',
    desc: '조건 없이 딱 1번. <b>모든 도망자 폰에서 동시에 비명이 터져요.</b> 사방에서 소리가 나니까 그 방향으로 <b>전원 위치가 한 번에 드러납니다.</b>'
  }
};

const RUNNER_SKILL_IDS = ['smoke', 'ghost'];
const SEEKER_SKILL_IDS = ['shriek'];

// 다같이 넘겨보는 튜토리얼 슬라이드. 각 슬라이드는 이모지 애니메이션 하나로 개념 하나만 설명한다.
const TUTORIAL_SLIDES = [
  {
    key: 'dark',
    title: '불 끄고 시작',
    stage: `<div class="stage">
      <span class="emo big a-bulb">💡</span>
      <span class="emo big a-dark">🌑</span>
    </div>`,
    caption: '방 불을 <b>완전히</b> 끕니다. 어두울수록 재밌어요.'
  },
  {
    key: 'roles',
    title: '술래 1명 vs 도망자 전원',
    stage: `<div class="stage">
      <span class="emo big a-shake">🙈</span>
      <span class="emo arrow">vs</span>
      <span class="emo a-scatter1">🧍</span>
      <span class="emo a-scatter2">🧍</span>
      <span class="emo a-scatter3">🧍</span>
    </div>`,
    caption: '<b>술래는 안대 착용.</b> 술래도 폰을 손에 들고 있어요.'
  },
  {
    key: 'danger',
    title: '가까워지면 위험도가 오른다',
    stage: `<div class="stage stage-track">
      <span class="emo big a-approach">🙈</span>
      <span class="emo big">🧍</span>
      <div class="mini-gauge"><div class="mini-gauge-fill a-fill"></div></div>
      <span class="emo a-buzz">📳</span>
    </div>`,
    caption: '술래 폰이 계속 소리를 냅니다. <b>내 폰이 그 소리를 듣고 위험도를 올려요.</b><br/>소리는 안 나고 <b>진동과 화면</b>으로만 알려줍니다.'
  },
  {
    key: 'smoke',
    title: '💣 연막탄 — 쫓길 때',
    stage: `<div class="stage">
      <span class="emo big">🧍</span>
      <span class="emo a-fly">💣</span>
      <span class="emo big a-boom">🧍</span>
      <span class="emo a-scream">📢</span>
    </div>`,
    caption: '위험도 <b>50 이상</b>일 때 · 2회<br/><b>다른 도망자 폰</b>이 비명을 지릅니다. 술래가 걔한테 달려가면 나는 튀는 거죠.',
    skillFor: 'runner'
  },
  {
    key: 'ghost',
    title: '👻 귀신소리 — 안전할 때',
    stage: `<div class="stage">
      <span class="emo big">🧍</span>
      <span class="emo a-fly">👻</span>
      <span class="emo big a-boom">🙈</span>
      <span class="emo a-scream">😱</span>
    </div>`,
    caption: '위험도 <b>30 이하</b>(멀리 있을 때)만 · 1회<br/><b>술래 폰</b>에서 비명이 터집니다. 놀래키고, 술래 위치도 드러나요.',
    skillFor: 'runner'
  },
  {
    key: 'shriek',
    title: '👹 괴성 — 술래 스킬',
    stage: `<div class="stage">
      <span class="emo big a-pulse">🙈</span>
      <span class="emo a-shock1">📢</span>
      <span class="emo a-shock2">📢</span>
      <span class="emo a-shock3">📢</span>
    </div>`,
    caption: '술래가 <b>화면을 1.5초 꾹</b> 누르면 · 1회<br/><b>모든 도망자 폰</b>이 동시에 비명. 사방에서 소리 나니까 전원 위치가 드러납니다.',
    skillFor: 'seeker'
  },
  {
    key: 'catch',
    title: '잡히면 "항복!!"',
    stage: `<div class="stage">
      <span class="emo big a-grab">🙈</span>
      <span class="emo big a-caught">🧍</span>
      <span class="emo a-surrender">🙌</span>
    </div>`,
    caption: '술래가 붙잡으면 <b>화면을 탭</b>합니다.<br/>진짜 잡힌 사람이 <b>"항복!!"</b> 외치고 자기 폰의 <b>항복 버튼</b>을 눌러 탈락해요.<br/><b>막을 방법은 없습니다.</b> 잡히면 끝.'
  },
  {
    key: 'win',
    title: '승패',
    stage: `<div class="stage">
      <span class="emo big a-pop1">⏰</span>
      <span class="emo big a-pop2">🏃</span>
      <span class="emo arrow">=</span>
      <span class="emo big a-pop3">🏆</span>
    </div>`,
    caption: '제한시간까지 <b>1명이라도 살아남으면 도망자 승</b>.<br/><b>전원 잡히면 술래 승.</b>'
  },
  {
    key: 'safety',
    title: '⚠️ 안전 수칙',
    stage: `<div class="stage">
      <span class="emo big a-pop1">🪑</span>
      <span class="emo big a-pop2">🚶</span>
      <span class="emo big a-pop3">✋</span>
    </div>`,
    caption: '부딪힐 물건·모서리·계단 <b>미리 치우기</b> · 뛰지 말고 <b>천천히 걷기</b> · 무섭거나 다치면 <b>"그만!"</b><br/><b>미디어 볼륨은 최대로!</b> 소리가 작으면 감지가 안 돼요.'
  }
];
