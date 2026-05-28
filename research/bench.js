#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ALGORITHMS } from './algorithms.js';

// ---------- CLI parsing ----------
function parseArgs(argv) {
  const args = {
    dice: 1,
    mode: 'normal', // normal | advantage | disadvantage
    dc: 10,
    rolls: 500000,
    algos: null, // null = all
    out: 'results.txt',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--dice': case '-d': args.dice = parseInt(next(), 10); break;
      case '--mode': case '-m': args.mode = next(); break;
      case '--dc': case '-t': args.dc = parseInt(next(), 10); break;
      case '--rolls': case '-r': args.rolls = parseInt(next(), 10); break;
      case '--algos': case '-a': args.algos = next().split(','); break;
      case '--out': case '-o': args.out = next(); break;
      case '--help': case '-h': printHelp(); process.exit(0);
      default:
        console.error(`Unknown arg: ${a}`);
        printHelp();
        process.exit(1);
    }
  }
  if (!['normal', 'advantage', 'disadvantage'].includes(args.mode)) {
    throw new Error(`Invalid mode: ${args.mode}`);
  }
  if (args.dice < 1) throw new Error('dice >= 1');
  if (args.dc < 1 || args.dc > 20) throw new Error('dc in [1..20]');
  if (args.rolls < 1) throw new Error('rolls >= 1');
  return args;
}

function printHelp() {
  console.log(`
D20 Randomness Bench

Usage:
  node bench.js [options]

Options:
  -d, --dice <N>            Dice per roll (default 1)
  -m, --mode <mode>         normal | advantage | disadvantage (default normal)
  -t, --dc <N>              Difficulty class threshold 1..20 (default 10)
  -r, --rolls <N>           Number of rolls per algorithm (default 500000)
  -a, --algos <a,b,c>       Comma list. Default: all except randomorg
                            Available: ${Object.keys(ALGORITHMS).join(', ')}
  -o, --out <file>          Output file (default results.txt)
  -h, --help                Show this help

Examples:
  node bench.js -r 1000000 -d 2 -m advantage -t 10
  node bench.js -a crypto,pcg32,xoshiro256ss -r 500000
  node bench.js -a randomorg -r 10000          # uses real entropy (slow)
`);
}

// ---------- Roll combiner ----------
function combineRolls(rolls, mode) {
  if (mode === 'normal') return rolls[0];
  if (mode === 'advantage') return Math.max(...rolls);
  if (mode === 'disadvantage') return Math.min(...rolls);
}

// ---------- Stats ----------
function analyze(faceCounts, total, dc, mode, dice) {
  // faceCounts indexed 1..20
  // Expected uniform probability for the FINAL combined face depends on mode.
  // For normal: p(k) = 1/20.
  // For advantage (max of N d20): p(k) = (k^N - (k-1)^N) / 20^N
  // For disadvantage (min of N d20): p(k) = ((21-k)^N - (20-k)^N) / 20^N
  const N = dice;
  const expected = new Array(21).fill(0);
  for (let k = 1; k <= 20; k++) {
    let p;
    if (mode === 'normal') p = 1 / 20;
    else if (mode === 'advantage') p = (Math.pow(k, N) - Math.pow(k - 1, N)) / Math.pow(20, N);
    else p = (Math.pow(21 - k, N) - Math.pow(20 - k, N)) / Math.pow(20, N);
    expected[k] = p * total;
  }

  // Chi-square statistic
  let chi2 = 0;
  for (let k = 1; k <= 20; k++) {
    const o = faceCounts[k];
    const e = expected[k];
    chi2 += ((o - e) ** 2) / e;
  }
  // df = 19. Critical value at p=0.05 ≈ 30.144, p=0.01 ≈ 36.191
  const dfCrit05 = 30.144, dfCrit01 = 36.191;

  // Success / fail
  let success = 0;
  for (let k = dc; k <= 20; k++) success += faceCounts[k];
  const fail = total - success;

  return { expected, chi2, dfCrit05, dfCrit01, success, fail };
}

// ---------- Bench one algorithm ----------
async function benchOne(algoName, factory, args) {
  const inst = factory();
  const isAsync = !!inst.async;
  const faceCounts = new Array(21).fill(0);
  const roll = isAsync ? inst.rollD20Async : inst.rollD20;

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < args.rolls; i++) {
    const dice = [];
    for (let j = 0; j < args.dice; j++) {
      dice.push(isAsync ? await roll() : roll());
    }
    const final = combineRolls(dice, args.mode);
    faceCounts[final]++;
  }
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;

  const stats = analyze(faceCounts, args.rolls, args.dc, args.mode, args.dice);
  return { name: inst.name, ms, faceCounts, ...stats };
}

// ---------- Format report ----------
function formatReport(result, args) {
  const lines = [];
  lines.push('='.repeat(72));
  lines.push(`ALGORITHM: ${result.name}`);
  lines.push('='.repeat(72));
  lines.push(`Rolls: ${args.rolls}   Dice: ${args.dice}   Mode: ${args.mode}   DC: ${args.dc}`);
  lines.push(`Time: ${result.ms.toFixed(2)} ms   (${(args.rolls / (result.ms / 1000)).toFixed(0)} rolls/sec)`);
  lines.push('');
  lines.push('Face | Count       | Observed % | Expected % | Deviation');
  lines.push('-----|-------------|------------|------------|-----------');
  for (let k = 1; k <= 20; k++) {
    const c = result.faceCounts[k];
    const obs = (c / args.rolls) * 100;
    const exp = (result.expected[k] / args.rolls) * 100;
    const dev = obs - exp;
    lines.push(
      ` ${String(k).padStart(2)}  | ${String(c).padStart(11)} | ${obs.toFixed(4).padStart(10)} | ${exp.toFixed(4).padStart(10)} | ${dev >= 0 ? '+' : ''}${dev.toFixed(4)}`
    );
  }
  lines.push('');
  const chi2Verdict = result.chi2 < result.dfCrit05
    ? 'PASS (uniform within 95% confidence)'
    : result.chi2 < result.dfCrit01
      ? 'WEAK (fails 95%, passes 99%)'
      : 'FAIL (deviates significantly from uniform)';
  lines.push(`Chi-square (df=19): ${result.chi2.toFixed(4)}   crit@0.05=${result.dfCrit05}   crit@0.01=${result.dfCrit01}`);
  lines.push(`Verdict: ${chi2Verdict}`);
  lines.push('');
  const sPct = (result.success / args.rolls) * 100;
  const fPct = (result.fail / args.rolls) * 100;
  lines.push(`Success (>= ${args.dc}): ${result.success} (${sPct.toFixed(4)}%)`);
  lines.push(`Failure  (<  ${args.dc}): ${result.fail} (${fPct.toFixed(4)}%)`);
  lines.push('');
  return lines.join('\n');
}

// ---------- Main ----------
async function main() {
  const args = parseArgs(process.argv);
  const selected = args.algos
    ? args.algos
    : Object.keys(ALGORITHMS).filter(k => k !== 'randomorg'); // skip slow API by default

  console.log(`Running ${selected.length} algorithm(s) x ${args.rolls} rolls...`);
  console.log(`Config: dice=${args.dice} mode=${args.mode} dc=${args.dc}`);
  console.log('');

  const header = [
    'D20 Randomness Benchmark',
    `Generated: ${new Date().toISOString()}`,
    `Config: rolls=${args.rolls} dice=${args.dice} mode=${args.mode} dc=${args.dc}`,
    `Algorithms: ${selected.join(', ')}`,
    '',
  ].join('\n');

  const sections = [header];
  const summary = [];

  for (const key of selected) {
    if (!ALGORITHMS[key]) {
      console.error(`Unknown algorithm: ${key}`);
      continue;
    }
    process.stdout.write(`  -> ${key}... `);
    const result = await benchOne(key, ALGORITHMS[key], args);
    console.log(`done (${result.ms.toFixed(0)}ms, chi2=${result.chi2.toFixed(2)})`);
    sections.push(formatReport(result, args));
    summary.push({
      name: result.name,
      ms: result.ms,
      chi2: result.chi2,
      successPct: (result.success / args.rolls) * 100,
    });
  }

  // Comparative summary table
  summary.sort((a, b) => a.chi2 - b.chi2);
  const sumLines = ['='.repeat(72), 'COMPARATIVE SUMMARY (sorted by chi-square, lower = more uniform)', '='.repeat(72)];
  sumLines.push('Algorithm           | Chi^2      | Time (ms)  | Success %');
  sumLines.push('--------------------|------------|------------|----------');
  for (const s of summary) {
    sumLines.push(
      `${s.name.padEnd(20)}| ${s.chi2.toFixed(4).padStart(10)} | ${s.ms.toFixed(2).padStart(10)} | ${s.successPct.toFixed(4)}`
    );
  }
  sumLines.push('');
  sections.push(sumLines.join('\n'));

  const outPath = path.resolve(args.out);
  fs.writeFileSync(outPath, sections.join('\n'));
  console.log(`\nResults written to: ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
