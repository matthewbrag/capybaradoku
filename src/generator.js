// Deterministic puzzle generator.
//
// generate(level) returns the SAME puzzle for a given level on every device,
// because it is driven entirely by a seed derived from the level number. For
// each level it:
//   1. picks a target grid size + difficulty band from the level (the "ramp"),
//   2. deterministically searches attempts (attempt 0,1,2,...) until it finds a
//      puzzle that has a UNIQUE solution and grades into the target band,
//   3. returns the first exact match (or the closest found, as a fallback).
//
// Because the attempt order is deterministic, "level 67" is identical for
// everyone running the same build.

import { hashSeed, makeRng } from "./rng.js";
import { countSolutions, grade, enumerateSolutions } from "./solver.js";

const idx = (N, r, c) => r * N + c;

// --- The difficulty ramp: level -> grid size + desired top tier ---
export function levelToParams(level) {
  let N;
  if (level <= 8) N = 7;
  else if (level <= 24) N = 8;
  else if (level <= 48) N = 9;
  else N = 10;

  // Desired hardest technique (1=Easy .. 4=Expert), climbing with level.
  let desired;
  if (level <= 5) desired = 1;
  else if (level <= 15) desired = 2;
  else if (level <= 35) desired = 3;
  else desired = 4;

  return { N, desired };
}

export const DIFFICULTY_NAMES = { 1: "Gentle", 2: "Easy", 3: "Tricky", 4: "Fiendish" };

// --- Generate a valid solution permutation (one cat per row/col, king-safe) ---
export function generateSolution(N, rng) {
  const col = new Int16Array(N);
  const usedCol = new Uint8Array(N);
  function rec(r) {
    if (r === N) return true;
    const order = rng.shuffle([...Array(N).keys()]);
    for (const c of order) {
      if (usedCol[c]) continue;
      if (r > 0 && Math.abs(c - col[r - 1]) < 2) continue;
      usedCol[c] = 1;
      col[r] = c;
      if (rec(r + 1)) return true;
      usedCol[c] = 0;
    }
    return false;
  }
  return rec(0) ? Array.from(col) : null;
}

// --- Grow N connected regions, one seeded at each solution cell ---
// Randomized multi-source BFS: every cell ends up in exactly one region, each
// region is connected, and each region contains exactly one solution cat.
export function growRegions(N, solution, rng) {
  const regionOf = new Int16Array(N * N).fill(-1);
  const frontier = []; // { cell, region }
  for (let r = 0; r < N; r++) {
    const cell = idx(N, r, solution[r]);
    regionOf[cell] = r; // region id == row index of its seed cat
  }
  const pushNeighbors = (cell, region) => {
    const r = Math.floor(cell / N),
      c = cell % N;
    const nb = [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ];
    for (const [nr, nc] of nb) {
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
      const ni = idx(N, nr, nc);
      if (regionOf[ni] === -1) frontier.push({ cell: ni, region });
    }
  };
  for (let r = 0; r < N; r++) pushNeighbors(idx(N, r, solution[r]), r);

  let remaining = N * N - N;
  while (remaining > 0 && frontier.length) {
    const k = rng.int(frontier.length);
    const { cell, region } = frontier[k];
    frontier.splice(k, 1);
    if (regionOf[cell] !== -1) continue;
    regionOf[cell] = region;
    remaining--;
    pushNeighbors(cell, region);
  }
  // Safety: if any cell was stranded (shouldn't happen on a 4-connected grid),
  // attach it to any assigned orthogonal neighbor.
  for (let i = 0; i < N * N; i++) {
    if (regionOf[i] !== -1) continue;
    const r = Math.floor(i / N),
      c = i % N;
    for (const [nr, nc] of [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ]) {
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
      const ni = idx(N, nr, nc);
      if (regionOf[ni] !== -1) {
        regionOf[i] = regionOf[ni];
        break;
      }
    }
  }

  // Eliminate any single-cell regions: grow each by claiming an orthogonal
  // neighbour donated by a region that can spare it (stays >= 2 and connected).
  const sizeOf = (g) => {
    let n = 0;
    for (let i = 0; i < N * N; i++) if (regionOf[i] === g) n++;
    return n;
  };
  for (let pass = 0; pass < N; pass++) {
    let fixed = true;
    for (let g = 0; g < N; g++) {
      if (sizeOf(g) !== 1) continue;
      const seed = idx(N, g, solution[g]);
      const r = Math.floor(seed / N),
        c = seed % N;
      for (const [nr, nc] of rng.shuffle([
        [r - 1, c],
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
      ])) {
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        const ni = idx(N, nr, nc);
        const gD = regionOf[ni];
        if (gD === g) continue;
        // donor must stay >= 2 and connected after giving up `ni`
        if (regionStaysConnected(N, regionOf, ni, idx(N, gD, solution[gD]))) {
          regionOf[ni] = g;
          fixed = false;
          break;
        }
      }
    }
    if (fixed) break;
  }
  return Array.from(regionOf);
}

// Would removing `cell` from its region keep that region connected, still
// containing its seed AND at least 2 cells? Regions must stay contiguous, and we
// forbid single-cell regions (a lone cell trivially gives its capybara away).
function regionStaysConnected(N, regionOf, cell, seedCell) {
  const g = regionOf[cell];
  const members = [];
  for (let i = 0; i < N * N; i++) if (regionOf[i] === g && i !== cell) members.push(i);
  if (members.length < 2) return false; // keep every region size >= 2
  const memberSet = new Set(members);
  // BFS from the seed over remaining members.
  const start = seedCell !== cell ? seedCell : members[0];
  if (!memberSet.has(start)) return false;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const x = stack.pop();
    const r = Math.floor(x / N),
      c = x % N;
    for (const [nr, nc] of [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ]) {
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
      const ni = idx(N, nr, nc);
      if (memberSet.has(ni) && !seen.has(ni)) {
        seen.add(ni);
        stack.push(ni);
      }
    }
  }
  return seen.size === memberSet.size;
}

// Drive the region coloring toward a UNIQUE solution by guided boundary flips.
// Each flip takes a cell that an *alternate* solution relies on and moves it to
// a neighboring region, which makes the alternate invalid (two cats in one
// region) while leaving the intended solution untouched (it never uses that
// cell). We only keep a flip if the capped solution count drops.
function refineToUnique(N, regionOf, solution, rng, maxIter = 400) {
  const CAP = 12;
  const seedCell = (g) => idx(N, g, solution[g]); // region g's seed cat cell
  let cur = countSolutions({ N, regionOf, solution }, CAP);

  for (let iter = 0; iter < maxIter && cur > 1; iter++) {
    const sols = enumerateSolutions({ N, regionOf, solution }, 2);
    const alt = sols.find((s) => s.some((c, r) => c !== solution[r]));
    if (!alt) break; // already unique

    const diffRows = rng.shuffle(alt.map((c, r) => (c !== solution[r] ? r : -1)).filter((r) => r >= 0));
    let accepted = false;

    for (const r of diffRows) {
      const A = idx(N, r, alt[r]); // cell the alternate uses, solution does not
      const gA = regionOf[A];
      const rr = r,
        cc = alt[r];
      const neigh = rng.shuffle([
        [rr - 1, cc],
        [rr + 1, cc],
        [rr, cc - 1],
        [rr, cc + 1],
      ]);
      for (const [nr, nc] of neigh) {
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        const gB = regionOf[idx(N, nr, nc)];
        if (gB === gA) continue;
        if (!regionStaysConnected(N, regionOf, A, seedCell(gA))) continue;
        regionOf[A] = gB; // tentative flip
        const next = countSolutions({ N, regionOf, solution }, CAP);
        if (next < cur) {
          cur = next;
          accepted = true;
          break;
        }
        regionOf[A] = gA; // revert
      }
      if (accepted) break;
    }

    if (!accepted) {
      // Stuck: nudge a random legal boundary cell to escape the local minimum.
      const moved = randomBoundaryFlip(N, regionOf, solution, rng);
      if (!moved) break;
      cur = countSolutions({ N, regionOf, solution }, CAP);
    }
  }
  return cur;
}

// Move one random non-seed boundary cell into a neighboring region (keeping
// connectivity). Returns true if a flip happened.
function randomBoundaryFlip(N, regionOf, solution, rng) {
  const seeds = new Set(solution.map((c, r) => idx(N, r, c)));
  const cells = rng.shuffle([...Array(N * N).keys()]);
  for (const cell of cells) {
    if (seeds.has(cell)) continue;
    const gA = regionOf[cell];
    const r = Math.floor(cell / N),
      c = cell % N;
    const neigh = rng.shuffle([
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ]);
    for (const [nr, nc] of neigh) {
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
      const gB = regionOf[idx(N, nr, nc)];
      if (gB === gA) continue;
      if (!regionStaysConnected(N, regionOf, cell, idx(N, gA, solution[gA]))) continue;
      regionOf[cell] = gB;
      return true;
    }
  }
  return false;
}

// True if any region contains only one cell (disallowed — too easy).
function hasSingletonRegion(N, regionOf) {
  const counts = new Int16Array(N);
  for (let i = 0; i < N * N; i++) counts[regionOf[i]]++;
  for (let g = 0; g < N; g++) if (counts[g] < 2) return true;
  return false;
}

// Generate one UNIQUE, logic-solvable puzzle of size N from a seed string, with
// no difficulty targeting. Cheap (~one grow + refine). Returns puzzle+grade or
// null. This is the building block the offline baker uses to fill difficulty
// pools; the ramp is then imposed by sorting, not by expensive rejection.
export function generateUnique(N, seedStr, maxTierAllowed = 4) {
  const rng = makeRng(hashSeed(seedStr));
  const solution = generateSolution(N, rng);
  if (!solution) return null;
  const regionOf = growRegions(N, solution, rng);
  refineToUnique(N, regionOf, solution, rng);
  if (hasSingletonRegion(N, regionOf)) return null; // safety net: no lone cells
  if (countSolutions({ N, regionOf, solution }, 2) !== 1) return null;
  const g = grade({ N, regionOf, solution }, maxTierAllowed);
  if (!g.solved) return null; // not solvable within the allowed technique tier
  return { N, regionOf, solution, difficulty: g.maxTier, tierCounts: g.tierCounts };
}

// A finer difficulty score than the tier alone, for smooth ordering within a
// grid size: dominated by the hardest tier, tie-broken by how much hard work
// the puzzle demands.
export function difficultyScore(g) {
  return (
    g.difficulty * 1000 +
    (g.tierCounts[4] || 0) * 50 +
    (g.tierCounts[3] || 0) * 8 +
    (g.tierCounts[2] || 0) * 2
  );
}

// --- Main entry: deterministic per-level generation ---
export function generate(level, opts = {}) {
  const { N, desired } = levelToParams(level);
  const maxAttempts = opts.maxAttempts ?? 600;

  let best = null; // closest-to-desired fallback

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const seed = hashSeed(`capy|v1|${level}|${attempt}`);
    const rng = makeRng(seed);

    const solution = generateSolution(N, rng);
    if (!solution) continue;

    const regionOf = growRegions(N, solution, rng);
    refineToUnique(N, regionOf, solution, rng); // drive toward a unique solution
    if (hasSingletonRegion(N, regionOf)) continue; // no single-cell regions
    const puzzle = { N, regionOf, solution };

    if (countSolutions(puzzle, 2) !== 1) continue; // must be unique

    const g = grade(puzzle);
    if (!g.solved) continue; // must be logic-solvable (no pure guessing)

    const result = { level, N, regionOf, solution, difficulty: g.maxTier, tierCounts: g.tierCounts, attempts: attempt + 1 };
    if (g.maxTier === desired) return result; // exact band -> done

    // keep the closest as a fallback
    const dist = Math.abs(g.maxTier - desired);
    if (!best || dist < best._dist) {
      best = { ...result, _dist: dist };
    }
  }

  if (best) {
    delete best._dist;
    return best;
  }
  // Extremely unlikely: nothing valid found. Return a trivial solved fallback.
  return null;
}
