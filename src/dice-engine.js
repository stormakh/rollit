/**
 * D20 Dice Engine
 *
 * Primary entropy source: random.org JSON-RPC v4 (atmospheric noise).
 * Fallback: crypto.getRandomValues / node crypto (CSPRNG).
 *
 * Works in browser (Chrome extension) and Node.js (>=18 has global fetch).
 *
 * Usage:
 *   const engine = createDiceEngine({ apiKey: '...', bufferSize: 1000 });
 *   await engine.init();                                 // optional pre-fetch
 *   const result = await engine.roll({ dice: 2, mode: 'advantage', dc: 10 });
 *   // result = { rolls: [7, 15], final: 15, success: true, source: 'random.org' }
 */

const RANDOM_ORG_URL = 'https://api.random.org/json-rpc/4/invoke';
const MAX_INTS_PER_REQUEST = 10000; // random.org per-call limit
const DEFAULT_BUFFER_SIZE = 1000;
const REFILL_THRESHOLD_RATIO = 0.1; // refill when below 10% of buffer

// ----- Crypto fallback (uniform 1..20 via rejection sampling) -----
function getCryptoUint32() {
  // Browser
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    globalThis.crypto.getRandomValues(arr);
    return arr[0];
  }
  throw new Error('No crypto.getRandomValues available');
}

function cryptoD20() {
  const RANGE = 20;
  const LIMIT = Math.floor(0x100000000 / RANGE) * RANGE;
  while (true) {
    const x = getCryptoUint32() >>> 0;
    if (x < LIMIT) return (x % RANGE) + 1;
  }
}

// ----- Storage adapter (extension uses chrome.storage, node skips persistence) -----
function makeStorage(adapter) {
  if (adapter) return adapter;
  // chrome.storage.local if available (extension)
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return {
      get: (key) =>
        new Promise((res) => chrome.storage.local.get([key], (v) => res(v[key] ?? null))),
      set: (key, value) =>
        new Promise((res) => chrome.storage.local.set({ [key]: value }, res)),
    };
  }
  // In-memory (node / test)
  const mem = new Map();
  return {
    get: async (k) => (mem.has(k) ? mem.get(k) : null),
    set: async (k, v) => mem.set(k, v),
  };
}

// ----- random.org JSON-RPC call -----
async function fetchFromRandomOrg(apiKey, n, signal) {
  const body = {
    jsonrpc: '2.0',
    method: 'generateIntegers',
    params: {
      apiKey,
      n,
      min: 1,
      max: 20,
      replacement: true,
    },
    id: Date.now(),
  };

  const res = await fetch(RANDOM_ORG_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const json = await res.json();
  if (json.error) {
    throw new Error(`random.org RPC error ${json.error.code}: ${json.error.message}`);
  }

  return {
    data: json.result.random.data,
    bitsLeft: json.result.bitsLeft,
    requestsLeft: json.result.requestsLeft,
  };
}

// ----- Main engine factory -----
export function createDiceEngine(options = {}) {
  const {
    apiKey,
    bufferSize = DEFAULT_BUFFER_SIZE,
    storageAdapter,
    onSourceChange, // optional callback (source: 'random.org' | 'crypto')
    onQuotaUpdate, // optional callback ({ bitsLeft, requestsLeft })
    fetchTimeoutMs = 8000,
  } = options;

  if (!apiKey) throw new Error('apiKey is required');

  const storage = makeStorage(storageAdapter);
  const STORAGE_KEY = 'd20-buffer';
  const QUOTA_KEY = 'd20-quota';

  let buffer = [];
  let refilling = null; // promise dedup
  let currentSource = 'unknown';
  let degraded = false; // sticky flag: stay in fallback once API fails until manual reset

  const setSource = (src) => {
    if (src !== currentSource) {
      currentSource = src;
      if (onSourceChange) onSourceChange(src);
    }
  };

  async function loadBuffer() {
    const saved = await storage.get(STORAGE_KEY);
    if (Array.isArray(saved)) buffer = saved;
  }

  async function saveBuffer() {
    await storage.set(STORAGE_KEY, buffer);
  }

  async function refill(count = bufferSize) {
    if (degraded) return; // skip API if degraded
    if (refilling) return refilling;

    const n = Math.min(count, MAX_INTS_PER_REQUEST);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);

    refilling = (async () => {
      try {
        const { data, bitsLeft, requestsLeft } = await fetchFromRandomOrg(
          apiKey,
          n,
          controller.signal
        );
        buffer.push(...data);
        await saveBuffer();
        await storage.set(QUOTA_KEY, { bitsLeft, requestsLeft, ts: Date.now() });
        if (onQuotaUpdate) onQuotaUpdate({ bitsLeft, requestsLeft });
        setSource('random.org');
      } catch (err) {
        console.warn('[dice-engine] random.org failed, falling back to crypto:', err.message);
        degraded = true;
        setSource('crypto');
      } finally {
        clearTimeout(timer);
        refilling = null;
      }
    })();

    return refilling;
  }

  async function init() {
    await loadBuffer();
    if (buffer.length < bufferSize * REFILL_THRESHOLD_RATIO) {
      await refill();
    } else {
      setSource('random.org');
    }
  }

  function nextFromBuffer() {
    if (buffer.length === 0) return null;
    const v = buffer.shift();
    // Fire-and-forget refill when low
    if (buffer.length < bufferSize * REFILL_THRESHOLD_RATIO && !refilling && !degraded) {
      refill();
    }
    return v;
  }

  function singleD20() {
    const fromApi = nextFromBuffer();
    if (fromApi != null) return { value: fromApi, source: 'random.org' };
    return { value: cryptoD20(), source: 'crypto' };
  }

  function combine(rolls, mode) {
    if (mode === 'advantage') return Math.max(...rolls);
    if (mode === 'disadvantage') return Math.min(...rolls);
    return rolls[0];
  }

  async function roll({ dice = 1, mode = 'normal', dc = 10 } = {}) {
    // Ensure buffer has enough for full roll if possible
    if (!degraded && buffer.length < dice && !refilling) {
      // Try sync refill before rolling
      await refill();
    }

    const rolls = [];
    const sources = new Set();
    for (let i = 0; i < dice; i++) {
      const { value, source } = singleD20();
      rolls.push(value);
      sources.add(source);
    }
    const final = combine(rolls, mode);
    const source = sources.size === 1 ? [...sources][0] : 'mixed';
    setSource(source === 'mixed' ? currentSource : source);

    return {
      rolls,
      final,
      success: final >= dc,
      mode,
      dc,
      source,
      bufferRemaining: buffer.length,
    };
  }

  async function getQuota() {
    return await storage.get(QUOTA_KEY);
  }

  function reset() {
    degraded = false;
    buffer = [];
  }

  /**
   * Synchronous single D20. Drains buffer (random.org) or falls back to crypto.
   * Fires async refill when buffer low. Never awaits the network.
   */
  function rollSync() {
    return singleD20();
  }

  /**
   * Synchronous multi-dice roll with mode + dc. Same shape as async roll().
   */
  function rollSyncFull({ dice = 1, mode = 'normal', dc = 10 } = {}) {
    const rolls = [];
    const sources = new Set();
    for (let i = 0; i < dice; i++) {
      const { value, source } = singleD20();
      rolls.push(value);
      sources.add(source);
    }
    const final = combine(rolls, mode);
    const source = sources.size === 1 ? [...sources][0] : 'mixed';
    setSource(source === 'mixed' ? currentSource : source);
    return {
      rolls,
      final,
      success: final >= dc,
      mode,
      dc,
      source,
      bufferRemaining: buffer.length,
    };
  }

  return {
    init,
    roll,
    rollSync,
    rollSyncFull,
    refill,
    getQuota,
    reset,
    getBufferSize: () => buffer.length,
    isDegraded: () => degraded,
    getSource: () => currentSource,
  };
}
