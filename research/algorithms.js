import crypto from 'node:crypto';
import { Random, MersenneTwister19937 } from 'random-js';

// Each algorithm exposes: name, init(seed?) -> rollD20() function
// rollD20 returns integer 1..20 with (ideally) uniform distribution.

// -------- Helpers --------

// Map a uint32 to [1..20] using rejection sampling to avoid modulo bias.
function uint32ToD20(nextUint32) {
  const RANGE = 20;
  // Largest multiple of 20 that fits in uint32
  const LIMIT = Math.floor(0x100000000 / RANGE) * RANGE; // 4294967280
  while (true) {
    const x = nextUint32() >>> 0;
    if (x < LIMIT) return (x % RANGE) + 1;
  }
}

// -------- Algorithms --------

// 1. Math.random (baseline — known mediocre, browser-dependent)
function mathRandom() {
  return {
    name: 'math.random',
    rollD20: () => Math.floor(Math.random() * 20) + 1,
  };
}

// 2. Node crypto.randomInt — CSPRNG (OpenSSL, /dev/urandom under hood)
function nodeCrypto() {
  return {
    name: 'node-crypto',
    rollD20: () => crypto.randomInt(1, 21), // [1, 21)
  };
}

// 3. Mulberry32 — small, fast, decent quality (fails PractRand at 32GB)
function mulberry32(seed = Date.now() >>> 0) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  };
  return { name: 'mulberry32', rollD20: () => uint32ToD20(next) };
}

// 4. sfc32 — 128-bit state, top-tier JS PRNG quality
function sfc32(seed = Date.now()) {
  let a = seed >>> 0, b = (seed * 2) >>> 0, c = (seed * 3) >>> 0, d = 1;
  // warmup
  const next = () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = ((c << 21) | (c >>> 11));
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) next();
  return { name: 'sfc32', rollD20: () => uint32ToD20(next) };
}

// 5. xoshiro256** — 256-bit state, high quality but lower-bit weakness mitigated
//    Using BigInt for 64-bit ops.
function xoshiro256ss(seed = BigInt(Date.now())) {
  const MASK = 0xFFFFFFFFFFFFFFFFn;
  // splitmix64 to seed state
  let sm = seed & MASK;
  const splitmix = () => {
    sm = (sm + 0x9E3779B97F4A7C15n) & MASK;
    let z = sm;
    z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & MASK;
    return (z ^ (z >> 31n)) & MASK;
  };
  let s0 = splitmix(), s1 = splitmix(), s2 = splitmix(), s3 = splitmix();
  const rotl = (x, k) => ((x << k) | (x >> (64n - k))) & MASK;
  const next64 = () => {
    const result = (rotl((s1 * 5n) & MASK, 7n) * 9n) & MASK;
    const t = (s1 << 17n) & MASK;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 45n);
    return result;
  };
  const next = () => Number(next64() >> 32n); // upper 32 bits
  return { name: 'xoshiro256**', rollD20: () => uint32ToD20(next) };
}

// 6. PCG32 — Permuted Congruential Generator (state of art, default in numpy variant)
function pcg32(seed = BigInt(Date.now())) {
  const MASK64 = 0xFFFFFFFFFFFFFFFFn;
  const MULT = 6364136223846793005n;
  const INC = 1442695040888963407n;
  let state = (seed + INC) & MASK64;
  const step = () => { state = (state * MULT + INC) & MASK64; };
  step();
  const next = () => {
    const oldstate = state;
    step();
    const xorshifted = Number(((oldstate >> 18n) ^ oldstate) >> 27n) & 0xFFFFFFFF;
    const rot = Number(oldstate >> 59n) & 31;
    return ((xorshifted >>> rot) | (xorshifted << ((-rot) & 31))) >>> 0;
  };
  return { name: 'pcg32', rollD20: () => uint32ToD20(next) };
}

// 7. Mersenne Twister via random-js (autoSeed from crypto)
function mersenne() {
  const engine = MersenneTwister19937.autoSeed();
  const r = new Random(engine);
  return { name: 'mersenne-twister', rollD20: () => r.integer(1, 20) };
}

// 8. random.org — atmospheric noise. Real entropy. Async + rate-limited.
//    Uses signed JSON-RPC endpoint with batching. No API key uses plain endpoint.
function randomOrg() {
  // Buffer pulls of 10000 at a time from plain endpoint.
  const BATCH = 10000;
  let buffer = [];
  const refill = async () => {
    const url = `https://www.random.org/integers/?num=${BATCH}&min=1&max=20&col=1&base=10&format=plain&rnd=new`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`random.org HTTP ${res.status}: ${await res.text()}`);
    const text = await res.text();
    buffer = text.trim().split('\n').map(n => parseInt(n, 10));
  };
  return {
    name: 'random.org',
    async: true,
    rollD20Async: async () => {
      if (buffer.length === 0) await refill();
      return buffer.pop();
    },
  };
}

export const ALGORITHMS = {
  math: mathRandom,
  crypto: nodeCrypto,
  mulberry32,
  sfc32,
  xoshiro256ss,
  pcg32,
  mersenne,
  randomorg: randomOrg,
};
