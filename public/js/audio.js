// 오디오/센서 관련 저수준 기능 모음 (비콘 재생, 마이크 RMS 측정, 효과음 합성, 진동, 흔들기 감지, 화면 꺼짐 방지)
const HorrorAudio = (() => {
  let ctx = null;
  let micStream = null;
  let analyser = null;
  let micData = null;
  let beaconNodes = null;
  let wakeLock = null;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // 술래용: 낮은 공포 비콘음을 계속 재생 (도망자들이 마이크로 이 소리 크기를 감지함)
  function startBeacon() {
    const c = getCtx();
    stopBeacon();

    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 65;

    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.55; // 심장박동 같은 느린 진폭 변조

    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.4;

    const mainGain = c.createGain();
    mainGain.gain.value = 0.55;

    lfo.connect(lfoGain);
    lfoGain.connect(mainGain.gain);
    osc.connect(mainGain);
    mainGain.connect(c.destination);

    osc.start();
    lfo.start();
    beaconNodes = { osc, lfo, mainGain };
  }

  function stopBeacon() {
    if (!beaconNodes) return;
    try {
      beaconNodes.osc.stop();
      beaconNodes.lfo.stop();
    } catch (e) { /* 이미 정지된 경우 무시 */ }
    beaconNodes = null;
  }

  // 도망자용: 마이크 스트림 시작 (AGC/노이즈 억제 끔 - 켜져 있으면 "가까울수록 큼" 신호가 자동보정으로 뭉개짐)
  async function startMic() {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    const c = getCtx();
    const source = c.createMediaStreamSource(micStream);
    analyser = c.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    micData = new Uint8Array(analyser.fftSize);
  }

  function sampleMicRMS() {
    if (!analyser) return 0;
    analyser.getByteTimeDomainData(micData);
    let sumSquares = 0;
    for (let i = 0; i < micData.length; i++) {
      const v = (micData[i] - 128) / 128;
      sumSquares += v * v;
    }
    return Math.sqrt(sumSquares / micData.length);
  }

  function stopMic() {
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    analyser = null;
    micData = null;
  }

  // 스킬 효과음: 화이트노이즈 + 대역필터 급강하로 "비명/잡음" 합성 (외부 음원 파일 불필요)
  function playScream(durationMs = 2200) {
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
    bandpass.frequency.setValueAtTime(2000, c.currentTime);
    bandpass.frequency.exponentialRampToValueAtTime(250, c.currentTime + dur);
    bandpass.Q.value = 5;

    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(1, c.currentTime + 0.06);
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
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (e) { /* 지원 안 하거나 거부되면 그냥 무시 */ }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  // 흔들기 감지 (술래가 화면을 못 보므로 잡기 시도는 흔들기로)
  function onShake(callback, threshold = 18, refractoryMs = 2000) {
    let last = 0;
    function handler(e) {
      const a = e.accelerationIncludingGravity || e.acceleration;
      if (!a) return;
      const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
      const now = Date.now();
      if (mag > threshold && now - last > refractoryMs) {
        last = now;
        callback();
      }
    }
    window.addEventListener('devicemotion', handler);
    return () => window.removeEventListener('devicemotion', handler);
  }

  async function requestMotionPermission() {
    // iOS 13+ 는 명시적 권한 요청 필요
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const res = await DeviceMotionEvent.requestPermission();
        return res === 'granted';
      } catch (e) {
        return false;
      }
    }
    return true;
  }

  return {
    getCtx, startBeacon, stopBeacon,
    startMic, stopMic, sampleMicRMS,
    playScream, vibrate,
    requestWakeLock, releaseWakeLock,
    onShake, requestMotionPermission
  };
})();
