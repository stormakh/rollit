import * as THREE from "three";
import "./styles.css";

const canvas = document.querySelector("#dice");
const dcInput = document.querySelector("#dc");
const modifierInput = document.querySelector("#modifier");
const dicePresetInput = document.querySelector("#dicePreset");
const soundPresetInput = document.querySelector("#soundPreset");
const rollModeInput = document.querySelector("#rollMode");
const openRouterKeyInput = document.querySelector("#openRouterKey");
const rollButton = document.querySelector("#rollButton");
const situationCard = document.querySelector("#situationCard");
const situationInput = document.querySelector("#situationInput");
const chooseDifficultyButton = document.querySelector("#chooseDifficulty");
const difficultyLoader = document.querySelector("#difficultyLoader");
const aiDifficulty = document.querySelector("#aiDifficulty");
const captureShortcutButton = document.querySelector("#captureShortcut");
const shortcutSettingsButton = document.querySelector("#shortcutSettings");
const settingsToggle = document.querySelector("#settingsToggle");
const settingsPanel = document.querySelector("#settingsPanel");
const rollValue = document.querySelector("#rollValue");
const rollStatus = document.querySelector("#rollStatus");
const rollHint = document.querySelector("#rollHint");
const resultBox = rollButton;
const difficultyModel = "google/gemini-3.1-flash-lite";
const openRouterKeyStorageKey = "rollitOpenRouterKey";

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
goldEdgeGroup.name = "gold-edge-group";
die.add(goldEdgeGroup);
const faceNumbers = createFaceNumbers();
die.add(faceNumbers);
const secondDie = die.clone(true);
secondDie.visible = false;
scene.add(secondDie);
const dice = [die, secondDie];
const goldEdgeGroups = [goldEdgeGroup, secondDie.getObjectByName("gold-edge-group")];

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
let landingQuaternions = dice.map((diceMesh) => diceMesh.quaternion.clone());
let rollLastFrame = 0;
let spinVelocities = dice.map(() => new THREE.Vector3());
let residualAxes = dice.map(() => new THREE.Vector3(1, 0, 0));
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
let currentDifficultyText = "";

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

const masterSoundGain = 2.4;

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
  volume.gain.exponentialRampToValueAtTime(gain * masterSoundGain, now + 0.015);
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
  goldEdgeGroups.forEach((edgeGroup) => {
    edgeGroup.visible = Boolean(preset.fatEdges);
  });
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

function getVisibleDice() {
  return dice.filter((diceMesh) => diceMesh.visible);
}

function updateDiceLayout() {
  const useTwoDice = rollModeInput.value !== "normal";
  secondDie.visible = useTwoDice;

  if (useTwoDice) {
    die.position.x = -0.88;
    secondDie.position.x = 0.88;
    dice.forEach((diceMesh) => {
      diceMesh.position.y = 0;
      diceMesh.position.z = 0;
      diceMesh.scale.setScalar(0.62);
    });
    return;
  }

  die.position.set(0, 0, 0);
  die.scale.setScalar(1);
}

function randomD20() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return (values[0] % 20) + 1;
}

function setDifficultyStatus(message) {
  aiDifficulty.textContent = message;
}

function setDifficultyLoading(isLoading) {
  situationCard.classList.toggle("is-choosing", isLoading);
  difficultyLoader.hidden = !isLoading;
  situationInput.hidden = isLoading;
}

function showChosenDc(dc) {
  rollValue.hidden = false;
  rollValue.textContent = String(dc);
  rollStatus.textContent = "Roll";
  rollHint.textContent = `DC ${dc}`;
  resultBox.dataset.outcome = "";
  resultBox.classList.remove("is-pass", "is-fail", "is-rolling");
}

function parseDifficultyChoice(content) {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI response missing JSON");
  const parsed = JSON.parse(match[0]);
  const dc = Number.parseInt(parsed.dc, 10);
  const label = String(parsed.label ?? "Custom");
  const reason = String(parsed.reason ?? "Situation judged");

  if (!Number.isInteger(dc) || dc < 1 || dc > 20) {
    throw new Error("AI response used invalid DC");
  }

  return { dc, label, reason };
}

async function getOpenRouterKey() {
  if (globalThis.chrome?.storage?.local) {
    const stored = await chrome.storage.local.get(openRouterKeyStorageKey);
    return stored[openRouterKeyStorageKey] ?? "";
  }

  return localStorage.getItem(openRouterKeyStorageKey) ?? "";
}

async function saveOpenRouterKey(value) {
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set({ [openRouterKeyStorageKey]: value });
    return;
  }

  localStorage.setItem(openRouterKeyStorageKey, value);
}

function buildDifficultyMessages(situation, capture) {
  const context = capture
    ? `Captured screen title: ${capture.title || "Unknown"}\nCaptured screen URL: ${capture.url || "Unknown"}`
    : "";
  const userText = situation
    ? `Situation: ${situation}\n${context}`
    : `Analyze the screenshot. Infer what is happening or what the user is trying to do, then choose a DC.\n${context}`;
  const userContent = [{ type: "text", text: userText.trim() }];

  if (capture?.screenshot) {
    userContent.push({
      type: "image_url",
      image_url: {
        url: capture.screenshot
      }
    });
  }

  return [
    {
      role: "system",
      content: "Choose a tabletop d20 difficulty class from 1 to 20 so an unmodified d20 roll can meet it. If an image is provided, analyze what is happening or what the user appears to be trying to do. Return only JSON: {\"dc\":number,\"label\":\"Easy|Medium|Hard|Very Hard|Legendary\",\"reason\":\"short reason\"}."
    },
    {
      role: "user",
      content: userContent
    }
  ];
}

async function chooseDifficulty(capture = null) {
  const situation = situationInput.value.trim();
  if (!situation && !capture?.screenshot) {
    setDifficultyStatus("Describe situation first");
    situationInput.focus();
    return;
  }

  chooseDifficultyButton.disabled = true;
  document.body.classList.remove("outcome-pass", "outcome-fail");
  setDifficultyLoading(true);
  setDifficultyStatus("AI choosing...");

  try {
    const openRouterKey = await getOpenRouterKey();
    if (!openRouterKey) {
      throw new Error("OpenRouter key missing. Add it in settings.");
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": location.origin,
        "X-Title": "Rollit"
      },
      body: JSON.stringify({
        model: difficultyModel,
        messages: buildDifficultyMessages(situation, capture),
        temperature: 0.2,
        max_tokens: 120
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const choice = parseDifficultyChoice(content);
    if (capture?.screenshot && !situation) {
      situationInput.value = "Screen capture";
    }
    dcInput.value = String(choice.dc);
    showChosenDc(choice.dc);
    currentDifficultyText = `DC ${choice.dc} - ${choice.label}: ${choice.reason}`;
    setDifficultyStatus(`${currentDifficultyText}\nRolling...`);
    roll();
  } catch (error) {
    console.error(error);
    setDifficultyStatus(`AI difficulty failed: ${error.message}`);
  } finally {
    setDifficultyLoading(false);
    chooseDifficultyButton.disabled = false;
  }
}

async function captureCurrentTab() {
  if (globalThis.chrome?.runtime) {
    try {
      const response = await chrome.runtime.sendMessage({ type: "capture-current-screen" });
      if (response?.ok) return response.capture;
      throw new Error(response?.error || "Unknown capture error");
    } catch (error) {
      if (!globalThis.chrome?.tabs || !globalThis.chrome?.windows) throw error;
    }
  }

  if (!globalThis.chrome?.tabs || !globalThis.chrome?.windows) {
    throw new Error("Chrome capture APIs unavailable");
  }

  const window = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
  const screenshot = await chrome.tabs.captureVisibleTab(window.id, { format: "png" });

  return {
    screenshot,
    title: tab.title ?? "",
    url: tab.url ?? "",
    capturedAt: Date.now()
  };
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
  document.body.classList.remove("outcome-pass", "outcome-fail");

  const rollMode = rollModeInput.value;
  const firstRoll = randomD20();
  const secondRoll = rollMode === "normal" ? null : randomD20();
  const natural = rollMode === "advantage"
    ? Math.max(firstRoll, secondRoll)
    : rollMode === "disadvantage"
      ? Math.min(firstRoll, secondRoll)
      : firstRoll;
  const dc = Math.min(Math.max(Number.parseInt(dcInput.value, 10) || 10, 1), 20);
  dcInput.value = String(dc);
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
  updateDiceLayout();
  dice.forEach((diceMesh) => {
    diceMesh.userData.hitPulse = 0;
  });
  holdUntil = 0;
  startRollSound();

  rollStart = performance.now();
  rollLastFrame = rollStart;
  rollDuration = 2100;
  landingQuaternions = [
    getLandingQuaternion(firstRoll),
    getLandingQuaternion(secondRoll ?? firstRoll)
  ];
  getVisibleDice().forEach((diceMesh, index) => {
    spinVelocities[index].set(
      8 + Math.random() * 4,
      12 + Math.random() * 5,
      6 + Math.random() * 4
    );
    if (Math.random() > 0.5) spinVelocities[index].x *= -1;
    if (Math.random() > 0.5) spinVelocities[index].z *= -1;
    residualAxes[index] = spinVelocities[index].clone().normalize();
  });
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
  getVisibleDice().forEach((diceMesh, index) => {
    diceMesh.quaternion.copy(landingQuaternions[index]);
  });
  stopRollSound();

  const { natural, firstRoll, secondRoll, rollMode, passed, total, dc } = pendingResult;
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
  if (currentDifficultyText) {
    const modifierText = total === natural ? "" : ` (${natural} + mod = ${total})`;
    setDifficultyStatus(`${currentDifficultyText}\nRolled ${natural}${modifierText} vs DC ${dc} - ${passed ? "Success" : "Fail"}`);
  }
  resultBox.dataset.outcome = passed ? "pass" : "fail";
  resultBox.classList.add(passed ? "is-pass" : "is-fail");
  document.body.classList.add(passed ? "outcome-pass" : "outcome-fail");
  getVisibleDice().forEach((diceMesh) => {
    diceMesh.userData.hitPulse = passed ? 1 : -1;
  });
  playOutcomeSound(passed);
}

function animate(now = performance.now()) {
  requestAnimationFrame(animate);

  if (rolling) {
    const progress = Math.min((now - rollStart) / rollDuration, 1);
    const deltaSeconds = Math.min((now - rollLastFrame) / 1000, 0.04);
    rollLastFrame = now;

    const settle = Math.max((progress - 0.58) / 0.42, 0);
    const damping = 1 - (0.55 + settle * 2.6) * deltaSeconds;

    getVisibleDice().forEach((diceMesh, index) => {
      const spinVelocity = spinVelocities[index];
      const speed = spinVelocity.length();
      if (speed > 0.001) {
        const axis = spinVelocity.clone().normalize();
        const spinStep = new THREE.Quaternion().setFromAxisAngle(axis, speed * deltaSeconds);
        diceMesh.quaternion.multiply(spinStep);
      }

      spinVelocity.multiplyScalar(Math.max(damping, 0));

      if (settle > 0) {
        const correction = 0.025 + 0.18 * settle * settle;
        const residual = new THREE.Quaternion().setFromAxisAngle(
          residualAxes[index],
          0.18 * Math.sin(settle * Math.PI * 7) * (1 - settle)
        );
        const target = landingQuaternions[index].clone().multiply(residual);
        diceMesh.quaternion.slerp(target, correction);
      }
    });

    if (progress >= 1) finishRoll();
  } else if (!draggingDie && now > holdUntil) {
    const inertiaSpeed = inertiaVelocity.length();
    if (inertiaSpeed > 0.0005) {
      getVisibleDice().forEach((diceMesh) => {
        diceMesh.rotation.y += inertiaVelocity.x;
        diceMesh.rotation.x += inertiaVelocity.y;
      });
      inertiaVelocity.multiplyScalar(0.965);
    } else {
      inertiaVelocity.set(0, 0);
      getVisibleDice().forEach((diceMesh, index) => {
        const direction = index === 0 ? 1 : -1;
        diceMesh.rotation.y += 0.006 * direction;
        diceMesh.rotation.x += 0.002;
      });
    }
  }

  getVisibleDice().forEach((diceMesh) => {
    const layoutScale = rollModeInput.value === "normal" ? 1 : 0.62;
    if (diceMesh.userData.hitPulse) {
      const pulse = diceMesh.userData.hitPulse;
      const targetScale = layoutScale * (pulse > 0 ? 1.12 : 0.92);
      diceMesh.scale.setScalar(THREE.MathUtils.lerp(diceMesh.scale.x, targetScale, 0.18));
      if (Math.abs(diceMesh.scale.x - targetScale) < 0.01) {
        diceMesh.userData.hitPulse = 0;
      }
    } else {
      diceMesh.scale.setScalar(THREE.MathUtils.lerp(diceMesh.scale.x, layoutScale, 0.12));
    }
  });

  renderer.render(scene, camera);
}

rollButton.addEventListener("click", roll);
chooseDifficultyButton.addEventListener("click", chooseDifficulty);
captureShortcutButton.addEventListener("click", async () => {
  if (!globalThis.chrome?.tabs) {
    setDifficultyStatus("Load extension to capture screen");
    return;
  }

  try {
    chooseDifficulty(await captureCurrentTab());
  } catch (error) {
    console.error(error);
    setDifficultyStatus(`Screen capture failed: ${error.message}`);
  }
});
shortcutSettingsButton.addEventListener("click", () => {
  if (globalThis.chrome?.tabs) {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    return;
  }

  setDifficultyStatus("Open chrome://extensions/shortcuts to change shortcut");
});
situationInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  chooseDifficulty();
});

async function consumePendingCapture() {
  if (!globalThis.chrome?.storage?.local) return false;

  const { pendingCapture, pendingCaptureError } = await chrome.storage.local.get([
    "pendingCapture",
    "pendingCaptureError"
  ]);
  if (pendingCaptureError) {
    await chrome.storage.local.remove("pendingCaptureError");
    setDifficultyStatus(`Screen capture failed: ${pendingCaptureError}`);
    return true;
  }
  if (!pendingCapture?.screenshot) return false;

  await chrome.storage.local.remove("pendingCapture");
  chooseDifficulty(pendingCapture);
  return true;
}

async function startCaptureOnOpen() {
  await consumePendingCapture();
}
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
  getVisibleDice().forEach((diceMesh) => {
    diceMesh.rotation.y += deltaX * 0.01;
    diceMesh.rotation.x += deltaY * 0.01;
  });
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
rollModeInput.addEventListener("change", updateDiceLayout);
soundPresetInput.addEventListener("change", () => {
  soundPreset = soundPresetInput.value;
});
openRouterKeyInput.addEventListener("change", () => {
  saveOpenRouterKey(openRouterKeyInput.value.trim());
});
settingsToggle.addEventListener("click", () => {
  const expanded = settingsToggle.getAttribute("aria-expanded") === "true";
  settingsToggle.setAttribute("aria-expanded", String(!expanded));
  settingsPanel.hidden = expanded;
});
window.addEventListener("resize", resize);
getOpenRouterKey().then((key) => {
  openRouterKeyInput.value = key;
});
applyDicePreset(dicePresetInput.value);
updateDiceLayout();
resize();
startCaptureOnOpen();
animate();
