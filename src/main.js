import * as THREE from "three";
import "./styles.css";
import { createDiceEngine } from "./dice-engine.js";

const RANDOM_ORG_KEY = import.meta.env.VITE_RANDOM_ORG_API_KEY;
let diceEngine = null;

if (RANDOM_ORG_KEY) {
  diceEngine = createDiceEngine({
    apiKey: RANDOM_ORG_KEY,
    bufferSize: 1000,
    onSourceChange: (src) => console.log(`[dice-engine] source: ${src}`),
    onQuotaUpdate: (q) =>
      console.log(`[dice-engine] quota bitsLeft=${q.bitsLeft} requestsLeft=${q.requestsLeft}`),
  });
  diceEngine.init().catch((err) => console.warn("[dice-engine] init failed:", err));
} else {
  console.warn("[dice-engine] VITE_RANDOM_ORG_API_KEY not set — using crypto fallback only");
}

const canvas = document.querySelector("#dice");
const dcInput = document.querySelector("#dc");
const modifierInput = document.querySelector("#modifier");
const dicePresetInput = document.querySelector("#dicePreset");
const soundPresetInput = document.querySelector("#soundPreset");
const rollModeInput = document.querySelector("#rollMode");
const rollButton = document.querySelector("#rollButton");
const settingsToggle = document.querySelector("#settingsToggle");
const settingsPanel = document.querySelector("#settingsPanel");
const rollValue = document.querySelector("#rollValue");
const rollStatus = document.querySelector("#rollStatus");
const rollHint = document.querySelector("#rollHint");
const resultBox = rollButton;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 0, 5);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const geometry = new THREE.IcosahedronGeometry(1.45, 0);
const material = new THREE.MeshStandardMaterial({
  color: 0xd63f2f,
  roughness: 0.45,
  metalness: 0.08,
  flatShading: true
});
const die = new THREE.Mesh(geometry, material);
scene.add(die);

const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x2b1110, transparent: true, opacity: 0.8 });
const edges = new THREE.LineSegments(
  new THREE.EdgesGeometry(geometry),
  edgeMaterial
);
die.add(edges);

const faceNormals = [];
const numberMaterials = [];
const goldEdgeMaterial = new THREE.MeshStandardMaterial({
  color: 0xd9a441,
  roughness: 0.18,
  metalness: 0.95
});
const goldEdgeGroup = createGoldEdges();
die.add(goldEdgeGroup);
const faceNumbers = createFaceNumbers();
die.add(faceNumbers);

const dicePresets = {
  crimson: {
    body: 0xd63f2f,
    edge: 0x2b1110,
    numbers: 0xfff7df,
    roughness: 0.45,
    metalness: 0.08
  },
  blackGold: {
    body: 0xd6a128,
    edge: 0x3a2607,
    numbers: 0xffe38a,
    roughness: 0.16,
    metalness: 0.98,
    fatEdges: true
  },
  ivory: {
    body: 0xf0e4c8,
    edge: 0x2c2418,
    numbers: 0x23190f,
    roughness: 0.6,
    metalness: 0.02
  }
};

function createGoldEdges() {
  const group = new THREE.Group();
  const position = geometry.attributes.position;
  const edgeGeometry = new THREE.CylinderGeometry(0.026, 0.026, 1, 8);
  const seen = new Set();

  for (let i = 0; i < position.count; i += 3) {
    const vertices = [
      new THREE.Vector3().fromBufferAttribute(position, i),
      new THREE.Vector3().fromBufferAttribute(position, i + 1),
      new THREE.Vector3().fromBufferAttribute(position, i + 2)
    ];

    for (let j = 0; j < 3; j += 1) {
      const a = vertices[j];
      const b = vertices[(j + 1) % 3];
      const key = [a, b]
        .map((vertex) => `${vertex.x.toFixed(3)},${vertex.y.toFixed(3)},${vertex.z.toFixed(3)}`)
        .sort()
        .join("|");

      if (seen.has(key)) continue;
      seen.add(key);

      const midpoint = a.clone().add(b).multiplyScalar(0.5);
      const direction = b.clone().sub(a);
      const edge = new THREE.Mesh(edgeGeometry, goldEdgeMaterial);
      edge.position.copy(midpoint.multiplyScalar(1.004));
      edge.scale.set(1, direction.length(), 1);
      edge.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      group.add(edge);
    }
  }

  group.visible = false;
  return group;
}

scene.add(new THREE.HemisphereLight(0xffffff, 0x301010, 2.4));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(3, 4, 5);
scene.add(keyLight);

let rolling = false;
let rollStart = 0;
let rollDuration = 0;
let landingQuaternion = die.quaternion.clone();
let rollLastFrame = 0;
let spinVelocity = new THREE.Vector3();
let residualAxis = new THREE.Vector3(1, 0, 0);
let holdUntil = 0;
let pendingResult = null;
let audioContext = null;
let rollTickTimer = null;
let rollFallbackTimer = null;
let hoverSoundReady = true;
let soundPreset = "arcade";
let draggingDie = false;
let dragLastX = 0;
let dragLastY = 0;
let dragLastTime = 0;
let inertiaVelocity = new THREE.Vector2(0, 0);

const soundPresets = {
  arcade: {
    tick: { type: "square", min: 90, max: 230, gain: 0.035, duration: 0.055, interval: 95 },
    pass: [
      { frequency: 523.25, duration: 0.18, gain: 0.065 },
      { frequency: 659.25, duration: 0.2, gain: 0.06, start: 0.08 },
      { frequency: 783.99, duration: 0.24, gain: 0.055, start: 0.16 }
    ],
    fail: [
      { frequency: 164.81, duration: 0.18, type: "sawtooth", gain: 0.07 },
      { frequency: 110, duration: 0.28, type: "triangle", gain: 0.06, start: 0.08 }
    ]
  },
  tabletop: {
    tick: { type: "triangle", min: 55, max: 120, gain: 0.055, duration: 0.035, interval: 72 },
    pass: [
      { frequency: 392, duration: 0.1, type: "triangle", gain: 0.055 },
      { frequency: 587.33, duration: 0.16, type: "triangle", gain: 0.05, start: 0.07 }
    ],
    fail: [
      { frequency: 82.41, duration: 0.12, type: "square", gain: 0.055 },
      { frequency: 73.42, duration: 0.18, type: "triangle", gain: 0.045, start: 0.05 }
    ]
  },
  mystic: {
    tick: { type: "sine", min: 180, max: 420, gain: 0.025, duration: 0.09, interval: 125 },
    pass: [
      { frequency: 440, duration: 0.28, gain: 0.045 },
      { frequency: 554.37, duration: 0.34, gain: 0.04, start: 0.12 },
      { frequency: 880, duration: 0.42, gain: 0.032, start: 0.24 }
    ],
    fail: [
      { frequency: 220, duration: 0.28, type: "sine", gain: 0.05 },
      { frequency: 185, duration: 0.34, type: "sine", gain: 0.04, start: 0.12 }
    ]
  }
};

function getAudioContext() {
  audioContext ??= new AudioContext();
  return audioContext;
}

function playTone({ frequency, duration, type = "sine", gain = 0.08, start = 0 }) {
  const context = getAudioContext();
  const oscillator = context.createOscillator();
  const volume = context.createGain();
  const now = context.currentTime + start;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  volume.gain.setValueAtTime(0.0001, now);
  volume.gain.exponentialRampToValueAtTime(gain, now + 0.015);
  volume.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(volume);
  volume.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

function playRollTick() {
  const { tick } = soundPresets[soundPreset];
  const frequency = tick.min + Math.random() * (tick.max - tick.min);
  playTone({ frequency, duration: tick.duration, type: tick.type, gain: tick.gain });
}

function startRollSound() {
  stopRollSound();
  playRollTick();
  rollTickTimer = window.setInterval(playRollTick, soundPresets[soundPreset].tick.interval);
}

function stopRollSound() {
  if (rollTickTimer) {
    window.clearInterval(rollTickTimer);
    rollTickTimer = null;
  }
}

function playOutcomeSound(passed) {
  const tones = passed ? soundPresets[soundPreset].pass : soundPresets[soundPreset].fail;
  tones.forEach((tone) => playTone(tone));
}

function playHoverSound() {
  if (!hoverSoundReady) return;
  hoverSoundReady = false;
  window.setTimeout(() => {
    hoverSoundReady = true;
  }, 900);
  void getAudioContext().resume();
  playTone({ frequency: 329.63, duration: 0.08, type: "sine", gain: 0.018 });
  playTone({ frequency: 493.88, duration: 0.12, type: "sine", gain: 0.012, start: 0.04 });
}

function createFaceNumbers() {
  const group = new THREE.Group();
  const position = geometry.attributes.position;
  const faceCount = position.count / 3;
  const labelGeometry = new THREE.PlaneGeometry(0.58, 0.32);

  for (let i = 0; i < faceCount; i += 1) {
    const a = new THREE.Vector3().fromBufferAttribute(position, i * 3);
    const b = new THREE.Vector3().fromBufferAttribute(position, i * 3 + 1);
    const c = new THREE.Vector3().fromBufferAttribute(position, i * 3 + 2);
    const center = a.clone().add(b).add(c).divideScalar(3);
    const normal = center.clone().normalize();
    faceNormals[i + 1] = normal.clone();

    const label = makeNumberLabel(i + 1, labelGeometry);
    label.position.copy(center.multiplyScalar(1.018));
    label.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    group.add(label);
  }

  return group;
}

function makeNumberLabel(number, labelGeometry) {
  const label = document.createElement("canvas");
  label.width = 128;
  label.height = 64;
  const context = label.getContext("2d");

  context.fillStyle = "rgba(255, 255, 255, 0)";
  context.fillRect(0, 0, label.width, label.height);
  context.lineWidth = 5;
  context.strokeStyle = "rgba(0, 0, 0, 0.55)";
  context.shadowColor = "rgba(255, 238, 164, 0.6)";
  context.shadowBlur = 8;
  context.font = "800 54px Copperplate, 'Copperplate Gothic Light', 'Hoefler Text', Georgia, serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.strokeText(String(number), label.width / 2, label.height / 2 + 1);
  context.fillStyle = "#fff7df";
  context.fillText(String(number), label.width / 2, label.height / 2 + 1);

  const texture = new THREE.CanvasTexture(label);
  const labelMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide
  });
  numberMaterials.push(labelMaterial);

  return new THREE.Mesh(labelGeometry, labelMaterial);
}

function applyDicePreset(name) {
  const preset = dicePresets[name] ?? dicePresets.crimson;
  material.color.setHex(preset.body);
  material.roughness = preset.roughness;
  material.metalness = preset.metalness;
  material.needsUpdate = true;
  edgeMaterial.color.setHex(preset.edge);
  edgeMaterial.opacity = preset.fatEdges ? 0.35 : 0.8;
  goldEdgeGroup.visible = Boolean(preset.fatEdges);
  goldEdgeMaterial.color.setHex(0xf1c65b);
  numberMaterials.forEach((numberMaterial) => {
    numberMaterial.color.setHex(preset.numbers);
  });
}

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const size = Math.floor(Math.min(rect.width, rect.height));
  renderer.setSize(size, size, false);
  camera.aspect = 1;
  camera.updateProjectionMatrix();
}

function randomD20() {
  if (diceEngine) return diceEngine.rollSync().value;
  // Fallback when engine not initialized: rejection sampling to avoid modulo bias.
  const RANGE = 20;
  const LIMIT = Math.floor(0x100000000 / RANGE) * RANGE;
  const values = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(values);
    if (values[0] < LIMIT) return (values[0] % RANGE) + 1;
  }
}

function getLandingQuaternion(number) {
  const faceNormal = faceNormals[number] ?? faceNormals[1];
  const cameraFacingNormal = new THREE.Vector3(0, 0, 1);
  const faceToCamera = new THREE.Quaternion().setFromUnitVectors(faceNormal, cameraFacingNormal);
  const uprightTurn = new THREE.Quaternion().setFromAxisAngle(cameraFacingNormal, -0.18);
  return uprightTurn.multiply(faceToCamera);
}

function roll() {
  if (rolling) return;
  void getAudioContext().resume();

  const rollMode = rollModeInput.value;
  const firstRoll = randomD20();
  const secondRoll = rollMode === "normal" ? null : randomD20();
  const natural = rollMode === "advantage"
    ? Math.max(firstRoll, secondRoll)
    : rollMode === "disadvantage"
      ? Math.min(firstRoll, secondRoll)
      : firstRoll;
  const dc = Number.parseInt(dcInput.value, 10) || 10;
  const modifier = Number.parseInt(modifierInput.value, 10) || 0;
  const total = natural + modifier;

  pendingResult = { natural, firstRoll, secondRoll, rollMode, modifier, total, dc, passed: total >= dc };
  rolling = true;
  rollButton.setAttribute("aria-busy", "true");
  rollStatus.textContent = "Rolling...";
  rollHint.textContent = "Hold...";
  rollValue.hidden = false;
  rollValue.textContent = "?";
  resultBox.dataset.outcome = "";
  resultBox.classList.remove("is-pass", "is-fail", "is-rolling");
  resultBox.classList.add("is-rolling");
  die.userData.hitPulse = 0;
  holdUntil = 0;
  startRollSound();

  rollStart = performance.now();
  rollLastFrame = rollStart;
  rollDuration = 2100;
  landingQuaternion = getLandingQuaternion(natural);
  spinVelocity.set(
    8 + Math.random() * 4,
    12 + Math.random() * 5,
    6 + Math.random() * 4
  );
  if (Math.random() > 0.5) spinVelocity.x *= -1;
  if (Math.random() > 0.5) spinVelocity.z *= -1;
  residualAxis = spinVelocity.clone().normalize();
  window.clearTimeout(rollFallbackTimer);
  rollFallbackTimer = window.setTimeout(() => {
    if (rolling) finishRoll();
  }, rollDuration + 250);
}

function finishRoll() {
  if (!rolling) return;
  rolling = false;
  rollButton.removeAttribute("aria-busy");
  window.clearTimeout(rollFallbackTimer);
  holdUntil = performance.now() + 3200;
  die.quaternion.copy(landingQuaternion);
  stopRollSound();

  const { natural, firstRoll, secondRoll, rollMode, passed } = pendingResult;
  resultBox.classList.remove("is-rolling");
  rollValue.classList.remove("value-reveal");
  void rollValue.offsetWidth;
  rollValue.hidden = false;
  rollValue.textContent = String(natural);
  rollValue.classList.add("value-reveal");
  rollStatus.textContent = passed ? "Success" : "Fail";
  rollHint.textContent = rollMode === "normal"
    ? "Click to roll again"
    : `${rollMode === "advantage" ? "Adv" : "Dis"} ${firstRoll}/${secondRoll} - click again`;
  resultBox.dataset.outcome = passed ? "pass" : "fail";
  resultBox.classList.add(passed ? "is-pass" : "is-fail");
  die.userData.hitPulse = passed ? 1 : -1;
  playOutcomeSound(passed);
}

function animate(now = performance.now()) {
  requestAnimationFrame(animate);

  if (rolling) {
    const progress = Math.min((now - rollStart) / rollDuration, 1);
    const deltaSeconds = Math.min((now - rollLastFrame) / 1000, 0.04);
    rollLastFrame = now;

    const speed = spinVelocity.length();
    if (speed > 0.001) {
      const axis = spinVelocity.clone().normalize();
      const spinStep = new THREE.Quaternion().setFromAxisAngle(axis, speed * deltaSeconds);
      die.quaternion.multiply(spinStep);
    }

    const settle = Math.max((progress - 0.58) / 0.42, 0);
    const damping = 1 - (0.55 + settle * 2.6) * deltaSeconds;
    spinVelocity.multiplyScalar(Math.max(damping, 0));

    if (settle > 0) {
      const correction = 0.025 + 0.18 * settle * settle;
      const residual = new THREE.Quaternion().setFromAxisAngle(
        residualAxis,
        0.18 * Math.sin(settle * Math.PI * 7) * (1 - settle)
      );
      const target = landingQuaternion.clone().multiply(residual);
      die.quaternion.slerp(target, correction);
    }

    if (progress >= 1) finishRoll();
  } else if (!draggingDie && now > holdUntil) {
    const inertiaSpeed = inertiaVelocity.length();
    if (inertiaSpeed > 0.0005) {
      die.rotation.y += inertiaVelocity.x;
      die.rotation.x += inertiaVelocity.y;
      inertiaVelocity.multiplyScalar(0.965);
    } else {
      inertiaVelocity.set(0, 0);
      die.rotation.y += 0.006;
      die.rotation.x += 0.002;
    }
  }

  if (die.userData.hitPulse) {
    const pulse = die.userData.hitPulse;
    const targetScale = pulse > 0 ? 1.12 : 0.92;
    die.scale.setScalar(THREE.MathUtils.lerp(die.scale.x, targetScale, 0.18));
    if (Math.abs(die.scale.x - targetScale) < 0.01) {
      die.userData.hitPulse = 0;
    }
  } else {
    die.scale.setScalar(THREE.MathUtils.lerp(die.scale.x, 1, 0.12));
  }

  renderer.render(scene, camera);
}

rollButton.addEventListener("click", roll);
canvas.addEventListener("pointerdown", (event) => {
  if (rolling) return;
  draggingDie = true;
  holdUntil = performance.now();
  inertiaVelocity.set(0, 0);
  dragLastX = event.clientX;
  dragLastY = event.clientY;
  dragLastTime = performance.now();
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!draggingDie || rolling) return;
  const now = performance.now();
  const deltaX = event.clientX - dragLastX;
  const deltaY = event.clientY - dragLastY;
  const deltaTime = Math.max(now - dragLastTime, 16);
  dragLastX = event.clientX;
  dragLastY = event.clientY;
  dragLastTime = now;

  const nextVelocity = new THREE.Vector2(
    (deltaX / deltaTime) * 0.16,
    (deltaY / deltaTime) * 0.16
  );
  inertiaVelocity.lerp(nextVelocity, 0.35);
  die.rotation.y += deltaX * 0.01;
  die.rotation.x += deltaY * 0.01;
});
function endDieDrag(event) {
  draggingDie = false;
  holdUntil = performance.now();
  inertiaVelocity.clampLength(0, 0.22);
  if (event && canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

canvas.addEventListener("pointerup", endDieDrag);
canvas.addEventListener("pointercancel", () => {
  endDieDrag();
});
rollButton.addEventListener("mouseenter", playHoverSound);
window.addEventListener("pointermove", (event) => {
  const rect = rollButton.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);
  const maxDistance = 220;
  const proximity = Math.max(0, 1 - distance / maxDistance);
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;

  rollButton.style.setProperty("--mx", `${x}%`);
  rollButton.style.setProperty("--my", `${y}%`);
  rollButton.style.setProperty("--near", proximity.toFixed(3));
});
dicePresetInput.addEventListener("change", () => applyDicePreset(dicePresetInput.value));
soundPresetInput.addEventListener("change", () => {
  soundPreset = soundPresetInput.value;
});
settingsToggle.addEventListener("click", () => {
  const expanded = settingsToggle.getAttribute("aria-expanded") === "true";
  settingsToggle.setAttribute("aria-expanded", String(!expanded));
  settingsPanel.hidden = expanded;
});
window.addEventListener("resize", resize);
applyDicePreset(dicePresetInput.value);
resize();
animate();
