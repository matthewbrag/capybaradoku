// Offline level baker. Run: `node tools/bake.mjs` -> writes src/levels.json.
//
// Builds a curated difficulty ramp. For each (grid size, target tier) block it
// deterministically searches seeds, keeping only puzzles that (a) have a unique
// solution and (b) grade to EXACTLY that tier. Grading is capped at the target
// tier, so easy blocks skip the expensive trial solver and bake fast.
//
// The ramp mixes grid size and technique tier so difficulty rises smoothly:
// small boards teach the ideas; big boards become the real challenge. Scale the
// `count`s up freely — the JSON is ~160 bytes/level, so thousands are trivial.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateUnique, difficultyScore } from "../src/generator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The ramp: ordered blocks of { N, tier, count }. tier 1=Gentle..4=Fiendish.
// Tiers that are naturally rare at a given size (e.g. Gentle at 10x10) are left
// out on purpose.
// NOTE: with single-cell regions banned, tier 1 (Gentle) is effectively extinct
// (a lone cell was the source of instant free singles), so the ramp starts at
// tier 2 (Easy).
// ~2,000-level ramp. Rare/slow combos (Easy@9, Tricky@10) are kept small; the
// abundant, fast tiers carry the bulk so the bake stays to ~35-45 min.
const PLAN = [
  { N: 7, tier: 2, count: 50 },
  { N: 7, tier: 3, count: 100 },
  { N: 7, tier: 4, count: 80 },
  { N: 8, tier: 2, count: 50 },
  { N: 8, tier: 3, count: 200 },
  { N: 8, tier: 4, count: 200 },
  { N: 9, tier: 2, count: 25 },
  { N: 9, tier: 3, count: 300 },
  { N: 9, tier: 4, count: 770 },
  { N: 10, tier: 3, count: 25 },
  { N: 10, tier: 4, count: 200 },
];

function fillBlock({ N, tier, count }) {
  const found = [];
  const seen = new Set();
  const budget = count * 400 + 400;
  const t0 = performance.now();
  for (let seq = 0; found.length < count && seq < budget; seq++) {
    // Grade capped at the target tier: rejects harder puzzles instantly.
    const p = generateUnique(N, `bake|v2|${N}|${tier}|${seq}`, tier);
    if (!p || p.difficulty !== tier) continue;
    const key = p.regionOf.join("");
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(p);
  }
  found.sort((a, b) => difficultyScore(a) - difficultyScore(b));
  const dt = ((performance.now() - t0) / 1000).toFixed(1);
  const short = found.length < count ? ` (SHORT: wanted ${count})` : "";
  console.error(`  N=${N} tier ${tier}: ${found.length} in ${dt}s${short}`);
  return found;
}

const levels = [];
let levelNo = 1;
for (const block of PLAN) {
  for (const p of fillBlock(block)) {
    levels.push({
      level: levelNo++,
      N: p.N,
      difficulty: p.difficulty,
      regions: p.regionOf.map((r) => r.toString(36)).join(""),
      solution: p.solution,
    });
  }
}

const out = { version: 2, ruleset: "meowdoku-queens", count: levels.length, levels };
writeFileSync(join(__dirname, "..", "src", "levels.json"), JSON.stringify(out));
console.error(`\nWrote ${levels.length} levels (ramp: ${levels.map((l) => l.difficulty).join("")})`);
