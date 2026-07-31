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

  // ---------- 위험도 계산 ----------
  // 2점 자동 보정: ambientDb(주변 소음) = 위험도 0 기준, nearRefDb(다같이 모인 상태) = 100 기준.
  // 폰 스피커 음량/마이크 감도/방 크기가 제각각이라 절대 임계값은 어느 환경에서도 안 맞는다.
  // 음압은 거리에 따라 로그(dB)로 감쇠하므로 dB 구간을 선형 매핑하면 거리와 잘 대응한다.
  // (기준점 아래 24dB ≈ 모임 거리의 16배 지점까지)
  let ambientDb = -100;
  let nearRefDb = -40;
  let emaDb = -100;
  let dangerLoopHandle = null;
  let lastDisplayedDanger = 0;
  const EMA_ALPHA = 0.3;
  const BASE_SPAN_DB = 24;
  const DETECT_MARGIN_DB = 3; // 주변 소음보다 이만큼도 안 크면 아무것도 없는 것으로 간주

  function computeDanger(db) {
    if (db < ambientDb + DETECT_MARGIN_DB) return 0;
    const span = BASE_SPAN_DB / (latestSettings.sensitivity || 1);
    const floorDb = nearRefDb - span;
    return Math.max(0, Math.min(100, ((db - floorDb) / span) * 100));
  }

  let skillCharges = {};
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
  function saveCalibration() {
    try { sessionStorage.setItem('horrorTagCalib', JSON.stringify({ ambientDb, nearRefDb })); } catch (e) {}
  }
  function loadCalibration() {
    try {
      const c = JSON.parse(sessionStorage.getItem('horrorTagCalib') || 'null');
      if (c && Number.isFinite(c.ambientDb) && Number.isFinite(c.nearRefDb)) {
        ambientDb = c.ambientDb;
        nearRefDb = c.nearRefDb;
        return true;
      }
    } catch (e) {}
    return false;
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

  // ---------- 로비: 채팅 ----------
  const chatLog = document.getElementById('chat-log');
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');

  function appendChat(msg) {
    const mine = msg.playerId === myPlayerId;
    const li = document.createElement('div');
    li.className = 'chat-msg' + (mine ? ' mine' : '');
    li.innerHTML = `<span class="chat-name">${escapeHtml(msg.name)}</span><span class="chat-text">${escapeHtml(msg.text)}</span>`;
    chatLog.appendChild(li);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat:send', { text });
    chatInput.value = '';
  }

  chatSend.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
  });

  socket.on('chat:history', (msgs) => {
    chatLog.innerHTML = '';
    (msgs || []).forEach(appendChat);
  });
  socket.on('chat:msg', appendChat);

  // ---------- 로비: 감지 테스트 패널 ----------
  // 파티 시작하고 나서 "왜 안 올라가지?" 하는 상황을 막기 위해, 미리 폰 2대로
  // 비콘/측정을 확인하고 민감도를 조정해볼 수 있게 한다.
  const btnToggleTest = document.getElementById('btn-toggle-test');
  const testPanel = document.getElementById('test-panel');
  const btnTestBeacon = document.getElementById('btn-test-beacon');
  const btnTestMeasure = document.getElementById('btn-test-measure');
  const testReadout = document.getElementById('test-readout');
  const testDangerEl = document.getElementById('test-danger');
  const testRawEl = document.getElementById('test-raw');
  let testLoopHandle = null;

  btnToggleTest.addEventListener('click', () => {
    testPanel.hidden = !testPanel.hidden;
    if (testPanel.hidden) stopTestPanel();
  });

  btnTestBeacon.addEventListener('click', () => {
    if (HorrorAudio.isBeaconRunning()) {
      HorrorAudio.stopBeacon();
      btnTestBeacon.textContent = '🔊 비콘 켜기';
    } else {
      HorrorAudio.startBeacon();
      btnTestBeacon.textContent = '⏹️ 비콘 끄기';
    }
  });

  btnTestMeasure.addEventListener('click', async () => {
    if (testLoopHandle) { stopTestMeasure(); return; }
    const ok = await ensureMicStarted();
    if (!ok) return;

    btnTestMeasure.textContent = '측정 중... (기준 잡는 중)';
    testReadout.hidden = false;

    // 1.5초간 주변 소음을 재고, 그 위로 24dB를 100 기준으로 임시 매핑해서 감을 잡게 해준다
    const warm = [];
    const t0 = Date.now();
    const warmIv = setInterval(() => {
      warm.push(HorrorAudio.sampleBeaconDb());
      if (Date.now() - t0 < 1500) return;
      clearInterval(warmIv);
      const floor = warm.reduce((a, b) => a + b, 0) / Math.max(1, warm.length);
      btnTestMeasure.textContent = '⏹️ 측정 중지';

      let ema = floor;
      testLoopHandle = setInterval(() => {
        const raw = HorrorAudio.sampleBeaconDb();
        ema = ema * (1 - EMA_ALPHA) + raw * EMA_ALPHA;
        const snr = ema - floor;
        const pct = Math.max(0, Math.min(100, (snr / BASE_SPAN_DB) * 100));
        testDangerEl.textContent = Math.round(pct);
        testRawEl.textContent = `신호 ${snr.toFixed(1)} dB (주변 소음 대비)`;
      }, 150);
    }, 100);
  });

  function stopTestMeasure() {
    clearInterval(testLoopHandle);
    testLoopHandle = null;
    btnTestMeasure.textContent = '📈 측정 시작';
    testReadout.hidden = true;
  }

  function stopTestPanel() {
    stopTestMeasure();
    if (HorrorAudio.isBeaconRunning() && myRole !== 'seeker') {
      HorrorAudio.stopBeacon();
      btnTestBeacon.textContent = '🔊 비콘 켜기';
    }
  }

  // ---------- 튜토리얼 (방장이 넘기면 전원 화면이 같이 넘어감) ----------
  const myRoleBanner = document.getElementById('my-role-banner');
  const tutTitle = document.getElementById('tut-title');
  const tutStage = document.getElementById('tut-stage');
  const tutCaption = document.getElementById('tut-caption');
  const tutDots = document.getElementById('tut-dots');
  const tutMineBadge = document.getElementById('tut-mine-badge');
  const tutReadyCount = document.getElementById('tut-ready-count');
  const btnTutPrev = document.getElementById('btn-tut-prev');
  const btnTutNext = document.getElementById('btn-tut-next');
  const btnTutFinish = document.getElementById('btn-tut-finish');
  const btnTutorialAck = document.getElementById('btn-tutorial-ack');
  const tutorialWaitMsg = document.getElementById('tutorial-wait-msg');

  let currentSlide = 0;
  let iAmReady = false;

  function renderSlide(index) {
    currentSlide = Math.max(0, Math.min(TUTORIAL_SLIDES.length - 1, index));
    const slide = TUTORIAL_SLIDES[currentSlide];

    tutTitle.textContent = slide.title;
    tutCaption.innerHTML = slide.caption;
    // 애니메이션을 매번 처음부터 재생시키려면 노드를 새로 넣어야 한다
    tutStage.innerHTML = slide.stage;

    tutMineBadge.hidden = !(slide.skillFor && slide.skillFor === myRole);

    tutDots.innerHTML = TUTORIAL_SLIDES
      .map((_, i) => `<span class="dot${i === currentSlide ? ' on' : ''}"></span>`).join('');

    btnTutPrev.hidden = !isHost || currentSlide === 0;
    btnTutNext.hidden = !isHost || currentSlide === TUTORIAL_SLIDES.length - 1;
    updateFinishButton();
  }

  function updateFinishButton() {
    const onLastSlide = currentSlide === TUTORIAL_SLIDES.length - 1;
    btnTutFinish.hidden = !(isHost && onLastSlide);
    btnTutFinish.disabled = !lastTutorialState.allReady;
    btnTutFinish.textContent = lastTutorialState.allReady
      ? '게임 시작!'
      : `게임 시작 (${lastTutorialState.readyCount}/${lastTutorialState.total} 준비됨)`;
  }

  let lastTutorialState = { readyCount: 0, total: 0, allReady: false };

  btnTutPrev.addEventListener('click', () =>
    socket.emit('tutorial:goto', { index: currentSlide - 1, slideCount: TUTORIAL_SLIDES.length }));
  btnTutNext.addEventListener('click', () =>
    socket.emit('tutorial:goto', { index: currentSlide + 1, slideCount: TUTORIAL_SLIDES.length }));
  btnTutFinish.addEventListener('click', () => socket.emit('tutorial:finish'));

  socket.on('phase:tutorial', ({ role }) => {
    stopTestPanel();
    myRole = role;
    iAmReady = false;
    const isSeeker = role === 'seeker';
    myRoleBanner.textContent = isSeeker ? '🙈 당신은 술래' : '🧍 당신은 도망자';
    myRoleBanner.classList.toggle('seeker', isSeeker);

    btnTutorialAck.hidden = false;
    btnTutorialAck.disabled = false;
    btnTutorialAck.textContent = '✋ 준비 완료 (한 번 눌러주세요)';
    tutorialWaitMsg.hidden = true;
    renderSlide(0);
    showView('tutorial');
  });

  socket.on('tutorial:state', ({ slide, readyCount, total, allReady, readyIds }) => {
    lastTutorialState = { readyCount, total, allReady };
    tutReadyCount.textContent = `${readyCount}/${total} 준비`;
    tutReadyCount.classList.toggle('all', allReady);
    iAmReady = Array.isArray(readyIds) && readyIds.includes(myPlayerId);
    if (iAmReady) {
      btnTutorialAck.hidden = true;
      tutorialWaitMsg.hidden = isHost;
    }
    if (slide !== currentSlide) renderSlide(slide);
    else updateFinishButton();
  });

  btnTutorialAck.addEventListener('click', async () => {
    // 사용자 제스처(클릭) 안에서 오디오/마이크를 열어야 iOS에서 확실히 동작함
    if (myRole === 'seeker') {
      HorrorAudio.getCtx(); // 비콘 재생을 위한 AudioContext 잠금 해제
    } else {
      await ensureMicStarted();
    }
    btnTutorialAck.disabled = true;
    btnTutorialAck.textContent = '준비 완료!';
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
  const calibrationHint = document.getElementById('calibration-hint');
  const calibrationStepEl = document.getElementById('calibration-step');

  // 술래는 2단계 시작 신호를 받으면 비콘을 켠다 (도망자들이 "가까운 상태"를 측정할 수 있게)
  socket.on('calibration:beaconOn', () => {
    HorrorAudio.startBeacon();
  });

  socket.on('phase:calibration', async ({ stage, calibrationMs }) => {
    showView('calibration');
    calibrationProgress.style.width = '0%';
    calibrationStepEl.textContent = stage === 'ambient' ? '1 / 2' : '2 / 2';

    if (myRole !== 'runner') {
      calibrationTitle.textContent = stage === 'ambient' ? '안대를 착용해주세요' : '기준점 측정 중...';
      calibrationHint.textContent = stage === 'ambient'
        ? '다같이 조용히 해주세요'
        : '폰을 들고 다같이 모인 채로 잠시 기다리세요';
      return;
    }

    const ok = await ensureMicStarted();
    if (!ok) {
      calibrationTitle.textContent = '마이크 권한을 확인해주세요!';
      calibrationHint.textContent = '권한이 없으면 위험도가 오르지 않아요';
      socket.emit('calibration:done');
      return;
    }

    if (stage === 'ambient') {
      calibrationTitle.textContent = '주변 소음 측정 중...';
      calibrationHint.textContent = '다같이 조용히 해주세요';
    } else {
      calibrationTitle.textContent = '기준점 측정 중...';
      calibrationHint.textContent = '술래 옆에 다같이 모여 있으세요! (이 거리가 위험도 100 기준)';
    }

    const samples = [];
    const start = Date.now();
    const iv = setInterval(() => {
      samples.push(HorrorAudio.sampleBeaconDb());
      const elapsed = Date.now() - start;
      calibrationProgress.style.width = `${Math.min(100, (elapsed / calibrationMs) * 100)}%`;
      if (elapsed < calibrationMs) return;

      clearInterval(iv);
      // 앞쪽 샘플은 비콘이 막 켜진 직후라 불안정할 수 있어 뒤쪽 60%만 사용
      const stable = samples.slice(Math.floor(samples.length * 0.4));
      const avg = stable.reduce((a, b) => a + b, 0) / Math.max(1, stable.length);

      if (stage === 'ambient') {
        ambientDb = avg;
      } else {
        nearRefDb = avg;
        // 비콘이 주변 소음보다 확실히 크게 잡히지 않으면 볼륨 문제일 가능성이 높다
        if (nearRefDb < ambientDb + 6) {
          toast('⚠️ 술래 폰 소리가 잘 안 들려요! 미디어 볼륨을 최대로 올려주세요');
        }
      }
      saveCalibration(); // 새로고침/재접속해도 게이지 기준이 유지되도록
      socket.emit('calibration:done');
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
  const seekerTapArea = document.getElementById('seeker-tap-area');
  const seekerSkillStatus = document.getElementById('seeker-skill-status');
  const seekerFeedback = document.getElementById('seeker-feedback');

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
      if (!HorrorAudio.isBeaconRunning()) HorrorAudio.startBeacon(); // 보정 2단계에서 이미 켜졌으면 유지
      initSkillState('seeker');
      wireSeekerControls();
    } else {
      showView('playing-runner');
      runnerStatusEl.textContent = '생존 중';
      runnerStatusEl.classList.remove('caught');
      initSkillState('runner');
      renderRunnerSkillButtons();
      startDangerLoop();
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
      toast('💥 내 폰이 터졌다! 튀어!');
    }
  });

  socket.on('game:tensionPulse', () => {
    HorrorAudio.vibrate([80, 60, 80, 60, 200]);
  });

  socket.on('game:playerCaught', ({ playerId, name }) => {
    if (playerId === myPlayerId) {
      runnerStatusEl.textContent = '🙌 항복 (탈락)';
      runnerStatusEl.classList.add('caught');
      teardownRunnerLoop();
    } else {
      toast(`🙌 ${name}님 항복! (탈락)`);
    }
  });

  socket.on('game:over', ({ winner, reason, players }) => {
    teardownAllLoops();
    showResults(winner, reason, players);
  });

  // ---- 위험도 루프 (도망자) ----
  function startDangerLoop() {
    emaDb = ambientDb;
    lastDisplayedDanger = 0;
    clearInterval(dangerLoopHandle);
    let lastHapticAt = 0;
    dangerLoopHandle = setInterval(() => {
      const now = Date.now();
      const raw = HorrorAudio.sampleBeaconDb();
      emaDb = emaDb * (1 - EMA_ALPHA) + raw * EMA_ALPHA;

      const danger = computeDanger(emaDb);
      lastDisplayedDanger = danger;
      renderDanger(danger);
      socket.emit('game:dangerUpdate', { danger });
      updateSkillButtonStates(danger);

      // 위험할수록 진동이 잦고 강해진다 (소리는 안 냄 - 술래에게 위치가 들키니까)
      if (danger >= 80 && now - lastHapticAt > 600) { HorrorAudio.vibrate(180); lastHapticAt = now; }
      else if (danger >= 60 && now - lastHapticAt > 1100) { HorrorAudio.vibrate(110); lastHapticAt = now; }
      else if (danger >= 35 && now - lastHapticAt > 2400) { HorrorAudio.vibrate(60); lastHapticAt = now; }
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
        <span class="charges" id="hint-${id}">${chargesLabel(id)}</span>
      </button>`;
    }).join('');
    RUNNER_SKILL_IDS.forEach(id => {
      document.getElementById(`skill-${id}`).addEventListener('click', () => useSkill(id));
    });
    updateSkillButtonStates(0);
  }

  function updateSkillButtonStates(danger) {
    RUNNER_SKILL_IDS.forEach(id => {
      const btn = document.getElementById(`skill-${id}`);
      if (!btn) return;
      const meta = SKILL_META[id];
      const st = skillCharges[id];
      const inRange = danger >= meta.dangerThreshold && (meta.dangerMax == null || danger <= meta.dangerMax);
      const usable = st.left > 0 && inRange;
      btn.disabled = !usable;
      btn.classList.toggle('ready', usable);

      // 조건 미달일 땐 "왜 못 쓰는지"를 버튼에 그대로 보여준다 (어두워서 설명을 다시 못 읽으니까)
      const hintEl = document.getElementById(`hint-${id}`);
      if (hintEl) {
        if (st.left <= 0) hintEl.textContent = '소진';
        else if (meta.dangerThreshold > 0 && danger < meta.dangerThreshold) hintEl.textContent = `위험도 ${meta.dangerThreshold}+ 필요`;
        else if (meta.dangerMax != null && danger > meta.dangerMax) hintEl.textContent = `너무 가까움 (${meta.dangerMax} 이하)`;
        else hintEl.textContent = chargesLabel(id);
      }
    });
  }

  function useSkill(id) {
    socket.emit('game:useSkill', { skillId: id }, (res) => {
      if (!res.ok) {
        if (myRole === 'seeker') seekerSay(res.error || '사용 실패');
        else toast(res.error || '사용 실패');
        return;
      }
      const st = skillCharges[id];
      if (Number.isFinite(st.left)) st.left = Math.max(0, st.left - 1);
      const chargesEl = document.getElementById(`charges-${id}`);
      if (chargesEl) chargesEl.textContent = chargesLabel(id);

      if (id === 'smoke') toast('💣 연막탄! 다른 놈 폰이 터집니다');
      if (id === 'ghost') toast('👻 귀신소리! 술래 폰이 비명 지릅니다');
      if (id === 'shriek') { updateSeekerSkillStatus(); seekerSay('👹 괴성 발동! 비명 방향을 들으세요'); }
    });
  }

  // ---- 도망자: 항복(자율 탈락) ----
  btnCaught.addEventListener('click', () => {
    socket.emit('game:confirmCaught', {}, (res) => {
      if (res && res.ok === false && res.error) toast(res.error);
    });
  });

  // ---- 술래 컨트롤 ----
  // 안대를 쓰고 있어서 화면을 볼 수 없다. 그래서 화면 전체가 하나의 버튼이고,
  // 탭 / 길게누르기 두 동작만 있으며, 무엇이 발동됐는지는 진동 패턴으로 구분한다.
  const LONG_PRESS_MS = 1500;
  let pressTimer = null;
  let longPressFired = false;
  let seekerFeedbackTimer = null;

  function seekerSay(msg) {
    seekerFeedback.textContent = msg;
    clearTimeout(seekerFeedbackTimer);
    seekerFeedbackTimer = setTimeout(() => {
      seekerFeedback.textContent = '안대 쓰고 소리에 집중하세요';
    }, 2500);
  }

  function onSeekerPressStart(e) {
    e.preventDefault();
    longPressFired = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      longPressFired = true;
      if (skillCharges.shriek && skillCharges.shriek.left > 0) {
        HorrorAudio.vibrate([400]); // 길게 = 괴성
        useSkill('shriek');
      } else {
        HorrorAudio.vibrate([60, 60, 60]); // 짧게 3번 = 사용 불가
        seekerSay('괴성은 이미 다 썼어요');
      }
    }, LONG_PRESS_MS);
  }

  function onSeekerPressEnd(e) {
    e.preventDefault();
    clearTimeout(pressTimer);
    if (longPressFired) return; // 괴성이 나갔으면 탭으로 처리하지 않음
    HorrorAudio.vibrate([50]);  // 짧게 = 잡기 시도
    socket.emit('game:tagAttempt');
    seekerSay('잡기 시도! 잡힌 사람이 인정하면 반영됩니다');
  }

  function wireSeekerControls() {
    seekerTapArea.onpointerdown = onSeekerPressStart;
    seekerTapArea.onpointerup = onSeekerPressEnd;
    seekerTapArea.onpointercancel = () => clearTimeout(pressTimer);
    seekerTapArea.oncontextmenu = (e) => e.preventDefault(); // 길게 누를 때 메뉴 방지
    updateSeekerSkillStatus();
  }

  function updateSeekerSkillStatus() {
    const left = skillCharges.shriek ? skillCharges.shriek.left : 0;
    seekerSkillStatus.textContent = left > 0 ? `👹 괴성 ${left}회 남음` : '👹 괴성 소진';
    seekerSkillStatus.classList.toggle('spent', left <= 0);
  }

  // ---- 정리 ----
  function teardownRunnerLoop() {
    clearInterval(dangerLoopHandle);
    dangerLoopHandle = null;
  }

  function teardownAllLoops() {
    teardownRunnerLoop();
    stopTestPanel();
    HorrorAudio.stopBeacon();
    HorrorAudio.stopMic();
    HorrorAudio.releaseWakeLock();
    micStarted = false;
    clearTimeout(pressTimer);
    seekerTapArea.onpointerdown = null;
    seekerTapArea.onpointerup = null;
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
      const roleLabel = p.role === 'seeker' ? '🙈 술래' : (p.alive ? '🧍 생존' : '🙌 항복');
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
          if (!loadCalibration()) toast('보정값이 없어 위험도가 부정확할 수 있어요');
          ensureMicStarted().then(() => startDangerLoop());
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
