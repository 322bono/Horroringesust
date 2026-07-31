// 오디오/센서 저수준 기능 모음 (비콘 재생, 마이크 협대역 감지, 효과음 합성, 진동, 화면 꺼짐 방지)
//
// [중요] 비콘 주파수 설계 노트
// 폰 스피커는 저음(200Hz 이하)을 물리적으로 거의 재생하지 못한다. 초기 버전은 65Hz를 썼는데
// 그래서 소리가 사실상 안 나갔고, 마이크가 감지할 신호 자체가 없었다.
// 폰 스피커가 가장 효율적으로 소리를 내는 대역(1kHz 부근)을 캐리어로 쓰고,
// 감지도 그 좁은 대역의 에너지만 본다 -> 방 안 잡음(목소리/발소리)과 잘 구분된다.
const HorrorAudio = (() => {
  const BEACON_CENTER_HZ = 1000;
  const BEACON_DETUNE_HZ = 7;      // 1000 + 1007 맥놀이 -> 불안한 웅웅거림
  const BAND_LO_HZ = 940;
  const BAND_HI_HZ = 1075;

  let ctx = null;
  let micStream = null;
  let analyser = null;
  let freqData = null;
  let beaconNodes = null;
  let wakeLock = null;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // 술래용 비콘: 1kHz 부근 심장박동 펄스음. 가까울수록 도망자 마이크에 크게 잡힌다.
  function startBeacon() {
    const c = getCtx();
    stopBeacon();

    const carrier = c.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = BEACON_CENTER_HZ;

    const detuned = c.createOscillator();
    detuned.type = 'sine';
    detuned.frequency.value = BEACON_CENTER_HZ + BEACON_DETUNE_HZ;

    // 심장박동 트레몰로. 0으로 떨어뜨리지 않고 0.55~1.0 사이에서만 흔들어서
    // 감지 신호가 끊기지 않게 한다(끊기면 위험도 게이지가 요동침).
    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 1.15;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0.22;

    const tremolo = c.createGain();
    tremolo.gain.value = 0.78;

    // 분위기용 저음 럼블(감지에는 기여 안 하지만 사람 귀엔 공포감을 준다)
    const rumble = c.createOscillator();
    rumble.type = 'sawtooth';
    rumble.frequency.value = 70;
    const rumbleGain = c.createGain();
    rumbleGain.gain.value = 0.12;

    const master = c.createGain();
    master.gain.value = 0.95; // 감지가 생명이므로 최대한 크게

    lfo.connect(lfoDepth);
    lfoDepth.connect(tremolo.gain);
    carrier.connect(tremolo);
    detuned.connect(tremolo);
    tremolo.connect(master);
    rumble.connect(rumbleGain);
    rumbleGain.connect(master);
    master.connect(c.destination);

    carrier.start(); detuned.start(); lfo.start(); rumble.start();
    beaconNodes = { carrier, detuned, lfo, rumble, master };
  }

  function stopBeacon() {
    if (!beaconNodes) return;
    for (const key of ['carrier', 'detuned', 'lfo', 'rumble']) {
      try { beaconNodes[key].stop(); } catch (e) { /* 이미 정지 */ }
    }
    beaconNodes = null;
  }

  function isBeaconRunning() {
    return !!beaconNodes;
  }

  // 도망자용 마이크. AGC/노이즈 억제를 끄지 않으면 "가까울수록 커진다"는 신호가
  // 자동 보정으로 뭉개져서 게임이 성립하지 않는다.
  async function startMic() {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    const c = getCtx();
    const source = c.createMediaStreamSource(micStream);
    analyser = c.createAnalyser();
    analyser.fftSize = 4096;            // 48kHz 기준 약 11.7Hz 해상도
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);
    freqData = new Float32Array(analyser.frequencyBinCount);
  }

  function isMicReady() {
    return !!analyser;
  }

  // 비콘 대역(약 940~1075Hz)의 에너지만 dB로 반환.
  // 소리는 거리에 따라 로그(dB) 스케일로 감쇠하므로, 선형 RMS보다 거리와 훨씬 잘 대응한다.
  function sampleBeaconDb() {
    if (!analyser) return -120;
    analyser.getFloatFrequencyData(freqData);
    const binHz = getCtx().sampleRate / analyser.fftSize;
    const lo = Math.max(0, Math.floor(BAND_LO_HZ / binHz));
    const hi = Math.min(freqData.length - 1, Math.ceil(BAND_HI_HZ / binHz));

    let power = 0;
    for (let i = lo; i <= hi; i++) {
      const db = freqData[i];
      if (Number.isFinite(db)) power += Math.pow(10, db / 10);
    }
    return 10 * Math.log10(power + 1e-12);
  }

  function stopMic() {
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    analyser = null;
    freqData = null;
  }

  // 스킬 효과음: 화이트노이즈 + 대역필터 급강하로 비명 합성 (외부 음원 파일 불필요)
  function playScream(durationMs = 3000) {
    const c = getCtx();
    const dur = durationMs / 1000;

    const bufferSize = Math.floor(c.sampleRate * dur);
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = c.createBufferSource();
    noise.buffer = buffer;

    const bandpass = c.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(2600, c.currentTime);
    bandpass.frequency.exponentialRampToValueAtTime(320, c.currentTime + dur);
    bandpass.Q.value = 4;

    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(1, c.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);

    noise.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(c.destination);

    noise.start();
    noise.stop(c.currentTime + dur + 0.05);
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { /* 미지원/거부 시 무시 */ }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  return {
    getCtx, startBeacon, stopBeacon, isBeaconRunning,
    startMic, stopMic, sampleBeaconDb, isMicReady,
    playScream, vibrate,
    requestWakeLock, releaseWakeLock,
    BEACON_CENTER_HZ
  };
})();
