const streetView = document.getElementById("streetView");
const interiorView = document.getElementById("interiorView");
const boothTrigger = document.getElementById("boothTrigger");
const rotaryDial = document.getElementById("rotaryDial");
const dialDisplay = document.getElementById("dialDisplay");
const subtitleBox = document.getElementById("subtitleBox");
const scene = document.querySelector(".scene");

const MAX_DIGITS = 6;
const STEP_DEG = 23;
const CONNECTING_DELAY_MS = 5000;
const digitBuffer = [];

const state = {
  entered: false,
  pointerActive: false,
  pointerId: null,
  startAngle: 0,
  currentDigit: null,
  currentRotation: 0,
  maxRotation: 0,
  lastTickStep: 0
};

let audioUnlocked = false;
let audioCtx;
let ambientSource = null;
let ambientGain = null;
let subtitleTimeouts = [];

function createAudioWithFallback(candidates) {
  const audio = new Audio();
  const queue = [...candidates];
  const setNext = () => {
    const src = queue.shift();
    if (!src) return;
    audio.src = src;
    audio.load();
  };
  audio.addEventListener("error", setNext);
  setNext();
  return audio;
}

const sound = {
  door: createAudioWithFallback([
    "audio/open-door.mp3",
    "./audio/open-door.mp3",
    "open-door.mp3"
  ]),
  dial: createAudioWithFallback([
    "audio/PHONE DIAL 1.mp3",
    "./audio/PHONE DIAL 1.mp3",
    "PHONE DIAL 1.mp3",
    "audio/phone-dial.mp3"
  ]),
  call: createAudioWithFallback([
    "audio/call-audio.mp3",
    "./audio/call-audio.mp3",
    "call-audio.mp3"
  ])
};

Object.values(sound).forEach((item) => {
  if (!item) return;
  item.preload = "auto";
});

sound.call.loop = false;
sound.call.volume = 0.58;
sound.dial.volume = 0.65;
sound.door.volume = 0.75;

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  ensureAudioContext();
  sound.call.play().then(() => {
    sound.call.pause();
    sound.call.currentTime = 0;
  }).catch(() => {});
  sound.dial.play().then(() => {
    sound.dial.pause();
    sound.dial.currentTime = 0;
  }).catch(() => {});
}

function playSynthTone({ freq = 180, type = "sine", duration = 0.15, gain = 0.03, attack = 0.01, decay = 0.04 }) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const node = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  node.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  node.gain.exponentialRampToValueAtTime(gain, audioCtx.currentTime + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration + decay);
  osc.connect(node);
  node.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration + decay + 0.01);
}

function playDoorSound() {
  sound.door.currentTime = 0;
  sound.door.play().catch(() => {});
}

function playRingTone() {
  let pulse = 0;
  const ringInterval = setInterval(() => {
    playSynthTone({ freq: pulse % 2 ? 480 : 440, type: "sine", duration: 0.22, gain: 0.045, attack: 0.006, decay: 0.07 });
    pulse += 1;
    if (pulse > 8) clearInterval(ringInterval);
  }, 220);
}

function playDialAudio() {
  sound.dial.currentTime = 0;
  sound.dial.play().catch(() => {});
}

function getDialReturnMs(steps) {
  const byDigit = 520 + steps * 68;
  const byAudio = Number.isFinite(sound.dial.duration) && sound.dial.duration > 0.06
    ? Math.round(sound.dial.duration * 1000)
    : byDigit;
  return Math.max(360, Math.min(2200, byAudio));
}

function playReceiverDrop() {
  playSynthTone({ freq: 120, type: "triangle", duration: 0.08, gain: 0.08, attack: 0.004, decay: 0.06 });
  setTimeout(() => {
    playSynthTone({ freq: 90, type: "square", duration: 0.07, gain: 0.05, attack: 0.003, decay: 0.05 });
  }, 80);
}

function playAmbientWind() {
  if (!audioUnlocked || !audioCtx) return;
  if (ambientSource) return;
  const bufferSize = audioCtx.sampleRate * 2;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const output = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    output[i] = (Math.random() * 2 - 1) * 0.18;
  }

  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 520;
  filter.Q.value = 0.3;

  ambientGain = audioCtx.createGain();
  ambientGain.gain.value = 0.0001;

  noise.connect(filter);
  filter.connect(ambientGain);
  ambientGain.connect(audioCtx.destination);
  noise.start();

  ambientGain.gain.exponentialRampToValueAtTime(0.017, audioCtx.currentTime + 0.35);
  ambientSource = noise;
}

function stopAmbientWind() {
  if (!ambientGain || !audioCtx) return;
  ambientGain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.4);
  setTimeout(() => {
    if (ambientSource) {
      ambientSource.stop();
      ambientSource.disconnect();
      ambientSource = null;
      ambientGain = null;
    }
  }, 420);
}

function formatDigits() {
  const padded = [...digitBuffer];
  while (padded.length < MAX_DIGITS) padded.push("_");
  dialDisplay.textContent = padded.join(" ");
}

function positionDialHoles() {
  for (let digit = 1; digit <= 10; digit += 1) {
    const hole = document.createElement("button");
    hole.className = "dial-hole";
    hole.type = "button";
    hole.dataset.digit = String(digit % 10);
    hole.setAttribute("aria-label", `Dial ${digit % 10}`);
    hole.textContent = String(digit % 10);

    const angle = -66 + (digit - 1) * 28;
    const radius = 44;
    const rad = angle * (Math.PI / 180);
    const x = 50 + radius * Math.cos(rad);
    const y = 50 + radius * Math.sin(rad);

    hole.style.left = `${x}%`;
    hole.style.top = `${y}%`;
    hole.style.transform = "translate(-50%, -50%)";
    rotaryDial.appendChild(hole);
  }
}

function getAngleFromCenter(pointerEvent) {
  const rect = rotaryDial.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = pointerEvent.clientX - cx;
  const dy = pointerEvent.clientY - cy;
  const raw = Math.atan2(dy, dx) * (180 / Math.PI);
  return (raw + 360) % 360;
}

function clockwiseDiff(from, to) {
  let d = to - from;
  if (d < 0) d += 360;
  return d;
}

function startDial(event) {
  if (!state.entered || state.pointerActive || digitBuffer.length >= MAX_DIGITS) return;
  const hole = event.target.closest(".dial-hole");
  if (!hole) return;

  unlockAudio();
  ensureAudioContext();
  const digit = Number(hole.dataset.digit);
  const steps = digit === 0 ? 10 : digit;
  state.currentDigit = digit;
  state.maxRotation = steps * STEP_DEG;
  state.pointerActive = true;
  state.pointerId = event.pointerId;
  state.startAngle = getAngleFromCenter(event);
  state.currentRotation = 0;
  state.lastTickStep = 0;

  rotaryDial.classList.add("dragging");
  hole.setPointerCapture(event.pointerId);
}

function moveDial(event) {
  if (!state.pointerActive || event.pointerId !== state.pointerId) return;
  const angle = getAngleFromCenter(event);
  let rawPull = clockwiseDiff(state.startAngle, angle);
  if (rawPull > 260) rawPull = 0;
  const limited = Math.max(0, Math.min(state.maxRotation, rawPull));
  const normalized = state.maxRotation ? limited / state.maxRotation : 0;
  const resisted = state.maxRotation * Math.pow(normalized, 1.35);
  state.currentRotation = resisted;
  rotaryDial.style.setProperty("--dial-rotation", `${state.currentRotation}deg`);

  state.lastTickStep = Math.floor(state.currentRotation / 9);
}

function releaseDial(event) {
  if (!state.pointerActive || event.pointerId !== state.pointerId) return;
  state.pointerActive = false;
  state.pointerId = null;
  rotaryDial.classList.remove("dragging");

  const ratio = state.maxRotation ? state.currentRotation / state.maxRotation : 0;
  const accepted = ratio > 0.72;

  if (accepted) {
    playDialAudio();
  }

  const steps = state.currentDigit === 0 ? 10 : state.currentDigit;
  const returnMs = getDialReturnMs(steps);
  rotaryDial.style.transitionDuration = `${returnMs}ms`;
  rotaryDial.style.setProperty("--dial-rotation", "0deg");
  setTimeout(() => {
    if (accepted && digitBuffer.length < MAX_DIGITS) {
      digitBuffer.push(String(state.currentDigit));
      formatDigits();
      if (digitBuffer.length === MAX_DIGITS) {
        startConnectingSequence();
      }
    }
    state.currentDigit = null;
    state.currentRotation = 0;
    state.lastTickStep = 0;
    rotaryDial.style.transitionDuration = "";
  }, returnMs);
}

function startConnectingSequence() {
  subtitleTimeouts.forEach((id) => clearTimeout(id));
  subtitleTimeouts = [];
  subtitleBox.classList.add("visible");
  subtitleBox.innerHTML = `<span class="subtitle-line">Connecting ...</span>`;
  interiorView.classList.add("in-call");
  playRingTone();
  const connectId = setTimeout(() => {
    startCallPlayback();
  }, CONNECTING_DELAY_MS);
  subtitleTimeouts.push(connectId);
}

function startCallPlayback() {
  subtitleBox.classList.add("visible");
  interiorView.classList.add("in-call");
  scene.classList.add("call-mood");
  subtitleTimeouts.forEach((id) => clearTimeout(id));
  subtitleTimeouts = [];
  sound.call.currentTime = 0;
  subtitleBox.textContent = ".......";
  sound.call.play().catch(() => {});
}

function stopCallPlayback() {
  interiorView.classList.remove("in-call");
  scene.classList.remove("call-mood");
  subtitleBox.classList.remove("visible");
  subtitleBox.textContent = "";
  playReceiverDrop();
}

function enterBooth() {
  if (state.entered) return;
  unlockAudio();
  playDoorSound();
  if (window.gsap) {
    const tl = window.gsap.timeline();
    tl.to(".booth", { scale: 2.35, y: -24, duration: 0.88, ease: "power2.inOut" })
      .to(streetView, { opacity: 0, duration: 0.44, ease: "power2.out" }, "-=0.26")
      .fromTo(interiorView, { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: 0.64, ease: "power2.inOut" });
    tl.call(() => {
      streetView.classList.remove("active");
      interiorView.classList.add("active");
      state.entered = true;
      stopAmbientWind();
    });
    return;
  }

  streetView.classList.add("zooming");
  setTimeout(() => {
    streetView.classList.remove("active");
    interiorView.classList.add("active");
    state.entered = true;
    stopAmbientWind();
  }, 900);
}

boothTrigger.addEventListener("pointerenter", () => {
  ensureAudioContext();
  audioUnlocked = true;
  playAmbientWind();
});

boothTrigger.addEventListener("pointerleave", () => {
  stopAmbientWind();
});

boothTrigger.addEventListener("click", () => {
  enterBooth();
});

rotaryDial.addEventListener("pointerdown", startDial);
window.addEventListener("pointermove", moveDial);
window.addEventListener("pointerup", releaseDial);
window.addEventListener("pointercancel", releaseDial);

sound.call.addEventListener("ended", () => {
  stopCallPlayback();
});

positionDialHoles();
formatDigits();
