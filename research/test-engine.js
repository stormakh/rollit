#!/usr/bin/env node
/**
 * Smoke test for dice-engine.js
 *
 * Run:
 *   RANDOM_ORG_API_KEY=xxx node test-engine.js
 *   RANDOM_ORG_API_KEY=xxx node test-engine.js --rolls 100 --dice 2 --mode advantage
 */
import { createDiceEngine } from './dice-engine.js';

// Polyfill crypto.getRandomValues for Node (Node 18+ has globalThis.crypto)
if (!globalThis.crypto) {
  const nodeCrypto = await import('node:crypto');
  globalThis.crypto = nodeCrypto.webcrypto;
}

const apiKey = process.env.RANDOM_ORG_API_KEY;
if (!apiKey) {
  console.error('Set RANDOM_ORG_API_KEY env var');
  process.exit(1);
}

// Parse args
const args = { rolls: 20, dice: 1, mode: 'normal', dc: 10 };
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, '');
  const v = process.argv[i + 1];
  args[k] = ['rolls', 'dice', 'dc'].includes(k) ? parseInt(v, 10) : v;
}

const engine = createDiceEngine({
  apiKey,
  bufferSize: Math.max(100, args.rolls * args.dice * 2),
  onSourceChange: (src) => console.log(`[source] now using: ${src}`),
  onQuotaUpdate: (q) => console.log(`[quota] bitsLeft=${q.bitsLeft} requestsLeft=${q.requestsLeft}`),
});

console.log('Initializing engine...');
await engine.init();
console.log(`Buffer ready: ${engine.getBufferSize()} ints. Source: ${engine.getSource()}`);
console.log('');

const distribution = new Array(21).fill(0);
let successes = 0;
const sources = { 'random.org': 0, crypto: 0, mixed: 0 };

console.log(`Rolling ${args.rolls}x dice=${args.dice} mode=${args.mode} dc=${args.dc}`);
console.log('');

for (let i = 0; i < args.rolls; i++) {
  const r = await engine.roll(args);
  distribution[r.final]++;
  if (r.success) successes++;
  sources[r.source] = (sources[r.source] ?? 0) + 1;
  console.log(
    `  #${String(i + 1).padStart(3)} -> rolls=[${r.rolls.join(',')}] final=${r.final} ` +
    `${r.success ? 'SUCCESS' : 'fail   '} [${r.source}] buf=${r.bufferRemaining}`
  );
}

console.log('');
console.log('--- Summary ---');
console.log(`Success rate: ${((successes / args.rolls) * 100).toFixed(2)}% (${successes}/${args.rolls})`);
console.log(`Sources used: ${JSON.stringify(sources)}`);
console.log(`Degraded: ${engine.isDegraded()}`);
console.log(`Final buffer: ${engine.getBufferSize()}`);
const quota = await engine.getQuota();
if (quota) console.log(`Quota remaining: ${quota.bitsLeft} bits, ${quota.requestsLeft} requests`);
