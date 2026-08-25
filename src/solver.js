// Solver for the Meowdoku/Queens ruleset:
//   - N x N grid, N colored regions (a partition of the cells).
//   - Place exactly one cat per row, per column, and per region.
//   - No two cats king-adjacent (touching, incl. diagonally).
//
// Because there is one cat per row AND one per column, a solution is a
// permutation `col[r]` of columns. King-adjacency then reduces to a single
// between-consecutive-rows rule: |col[r] - col[r-1]| >= 2. The region rule adds
// that the N chosen cells hit each region exactly once.
//
// Two entry points:
//   countSolutions(puzzle, cap)  -> exact count (capped) for uniqueness checks.
//   grade(puzzle)                -> human-style difficulty grade.

const idx = (N, r, c) => r * N + c;

// ---------------------------------------------------------------------------
// Exhaustive solution counter (used to guarantee a unique solution).
// ---------------------------------------------------------------------------
export function countSolutions(puzzle, cap = 2) {
  const { N, regionOf } = puzzle;
  let count = 0;
  const usedCol = new Uint8Array(N);
  const usedReg = new Uint8Array(N);
  const col = new Int16Array(N);

  function rec(r) {
    if (count >= cap) return;
    if (r === N) {
      count++;
      return;
    }
    for (let c = 0; c < N; c++) {
      if (usedCol[c]) continue;
      if (r > 0 && Math.abs(c - col[r - 1]) < 2) continue; // king-adjacency
      const reg = regionOf[idx(N, r, c)];
      if (usedReg[reg]) continue;
      usedCol[c] = 1;
      usedReg[reg] = 1;
      col[r] = c;
      rec(r + 1);
      usedCol[c] = 0;
      usedReg[reg] = 0;
      if (count >= cap) return;
    }
  }
  rec(0);
  return count;
}

// Enumerate up to `cap` solutions as an array of col[] arrays. Used by the
// generator's refinement loop to grab a concrete alternate solution to destroy.
export function enumerateSolutions(puzzle, cap = 2) {
  const { N, regionOf } = puzzle;
  const out = [];
  const usedCol = new Uint8Array(N);
  const usedReg = new Uint8Array(N);
  const col = new Int16Array(N);
  function rec(r) {
    if (out.length >= cap) return;
    if (r === N) {
      out.push(Array.from(col));
      return;
    }
    for (let c = 0; c < N; c++) {
      if (usedCol[c]) continue;
      if (r > 0 && Math.abs(c - col[r - 1]) < 2) continue;
      const reg = regionOf[idx(N, r, c)];
      if (usedReg[reg]) continue;
      usedCol[c] = 1;
      usedReg[reg] = 1;
      col[r] = c;
      rec(r + 1);
      usedCol[c] = 0;
      usedReg[reg] = 0;
      if (out.length >= cap) return;
    }
  }
  rec(0);
  return out;
}

// Return one solution as col[] (or null). Handy for building puzzles/hints.
export function findSolution(puzzle) {
  const { N, regionOf } = puzzle;
  const usedCol = new Uint8Array(N);
  const usedReg = new Uint8Array(N);
  const col = new Int16Array(N);
  function rec(r) {
    if (r === N) return true;
    for (let c = 0; c < N; c++) {
      if (usedCol[c]) continue;
      if (r > 0 && Math.abs(c - col[r - 1]) < 2) continue;
      const reg = regionOf[idx(N, r, c)];
      if (usedReg[reg]) continue;
      usedCol[c] = 1;
      usedReg[reg] = 1;
      col[r] = c;
      if (rec(r + 1)) return true;
      usedCol[c] = 0;
      usedReg[reg] = 0;
    }
    return false;
  }
  return rec(0) ? Array.from(col) : null;
}

// ---------------------------------------------------------------------------
// Human-style logical solver, used to grade difficulty.
//
// It works on a candidate grid and applies techniques in tiers, always using
// the lowest tier that makes progress. The hardest tier it is forced into is
// the puzzle's difficulty.
//
//   Tier 1  Singles      a region/row/column with exactly one candidate.
//   Tier 2  Confinement  a region confined to one line frees that line (and
//                        the mirror: a line confined to one region).
//   Tier 3  Subsets      k rows whose candidate columns span exactly k columns
//                        reserve those columns (and the column/region mirrors).
//   Tier 4  Trial        assume a candidate; if propagation hits a
//                        contradiction, eliminate it (depth-1 forcing).
//
// Anything still unsolved after Tier 4 is considered "needs guessing" -> reject.
// ---------------------------------------------------------------------------

function makeState(puzzle) {
  const { N, regionOf } = puzzle;
  const cand = new Uint8Array(N * N).fill(1);
  const placedRow = new Int16Array(N).fill(-1); // col placed in row r, or -1
  const regionCells = Array.from({ length: N }, () => []);
  for (let i = 0; i < N * N; i++) regionCells[regionOf[i]].push(i);
  return { N, regionOf, cand, placedRow, regionCells, placedCount: 0 };
}

function cloneState(s) {
  return {
    N: s.N,
    regionOf: s.regionOf,
    cand: s.cand.slice(),
    placedRow: s.placedRow.slice(),
    regionCells: s.regionCells, // immutable, shared
    placedCount: s.placedCount,
  };
}

// Place a cat at (r,c) and eliminate everything it forbids. Returns false if
// this creates an immediate inconsistency.
function place(s, r, c) {
  const { N, regionOf } = s;
  if (s.placedRow[r] !== -1) return s.placedRow[r] === c;
  s.placedRow[r] = c;
  s.placedCount++;
  const reg = regionOf[idx(N, r, c)];
  for (let cc = 0; cc < N; cc++) s.cand[idx(N, r, cc)] = 0; // row
  for (let rr = 0; rr < N; rr++) s.cand[idx(N, rr, c)] = 0; // column
  for (const i of s.regionCells[reg]) s.cand[i] = 0; // region
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr,
        nc = c + dc;
      if (nr >= 0 && nr < N && nc >= 0 && nc < N) s.cand[idx(N, nr, nc)] = 0; // king
    }
  s.cand[idx(N, r, c)] = 2; // mark as the placed cell
  return true;
}

// Is the state broken? (some unplaced row/column/region has no candidate left.)
function contradicts(s) {
  const { N } = s;
  for (let r = 0; r < N; r++) {
    if (s.placedRow[r] !== -1) continue;
    let any = false;
    for (let c = 0; c < N; c++) if (s.cand[idx(N, r, c)] === 1) any = true;
    if (!any) return true;
  }
  // columns
  const placedCols = new Set();
  for (let r = 0; r < N; r++) if (s.placedRow[r] !== -1) placedCols.add(s.placedRow[r]);
  for (let c = 0; c < N; c++) {
    if (placedCols.has(c)) continue;
    let any = false;
    for (let r = 0; r < N; r++) if (s.cand[idx(N, r, c)] === 1) any = true;
    if (!any) return true;
  }
  // regions
  for (let g = 0; g < N; g++) {
    let placed = false,
      any = false;
    for (const i of s.regionCells[g]) {
      if (s.cand[i] === 2) placed = true;
      if (s.cand[i] === 1) any = true;
    }
    if (!placed && !any) return true;
  }
  return false;
}

// --- Tier 1: singles ---
function tier1(s) {
  const { N } = s;
  // region singles
  for (let g = 0; g < N; g++) {
    let placed = false,
      only = -1,
      cnt = 0;
    for (const i of s.regionCells[g]) {
      if (s.cand[i] === 2) placed = true;
      if (s.cand[i] === 1) {
        cnt++;
        only = i;
      }
    }
    if (!placed && cnt === 1) return place(s, Math.floor(only / N), only % N) && "1";
  }
  // row singles
  for (let r = 0; r < N; r++) {
    if (s.placedRow[r] !== -1) continue;
    let only = -1,
      cnt = 0;
    for (let c = 0; c < N; c++)
      if (s.cand[idx(N, r, c)] === 1) {
        cnt++;
        only = c;
      }
    if (cnt === 1) return place(s, r, only) && "1";
  }
  // column singles
  const placedCols = new Set();
  for (let r = 0; r < N; r++) if (s.placedRow[r] !== -1) placedCols.add(s.placedRow[r]);
  for (let c = 0; c < N; c++) {
    if (placedCols.has(c)) continue;
    let only = -1,
      cnt = 0;
    for (let r = 0; r < N; r++)
      if (s.cand[idx(N, r, c)] === 1) {
        cnt++;
        only = r;
      }
    if (cnt === 1) return place(s, only, c) && "1";
  }
  return false;
}

// --- Tiers 2 & 3: generalized subset reasoning over ALL constraint pairings ---
//
// Every solution assigns each ROW a column, each COLUMN a row, and each REGION a
// row and a column. So for any (slot dimension, value dimension) pair we can run
// the classic naked/hidden-subset argument: if k slots have candidate values
// confined to exactly k values, those values are reserved for those slots and
// can be eliminated from every other slot. k=1 is the "confinement/pointing"
// case (Tier 2); k>=2 is a true subset (Tier 3). We run all six pairings:
//   row->col, col->row, region->row, region->col, row->region, col->region.

const popcount = (x) => {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
};

// Enumerate the unplaced slots of `slotType`, each with the candidate cells it
// still owns and the bitmask of `valueType` values those cells cover.
function slotsFor(s, slotType, valueType) {
  const { N, regionOf } = s;
  const valueOf = (i) =>
    valueType === "col" ? i % N : valueType === "row" ? Math.floor(i / N) : regionOf[i];

  const out = [];
  const pushSlot = (cells) => {
    let mask = 0;
    for (const i of cells) mask |= 1 << valueOf(i);
    out.push({ cells, mask });
  };

  if (slotType === "row") {
    for (let r = 0; r < N; r++) {
      if (s.placedRow[r] !== -1) continue;
      const cells = [];
      for (let c = 0; c < N; c++) if (s.cand[idx(N, r, c)] === 1) cells.push(idx(N, r, c));
      if (cells.length) pushSlot(cells);
    }
  } else if (slotType === "col") {
    const placedCols = new Set();
    for (let r = 0; r < N; r++) if (s.placedRow[r] !== -1) placedCols.add(s.placedRow[r]);
    for (let c = 0; c < N; c++) {
      if (placedCols.has(c)) continue;
      const cells = [];
      for (let r = 0; r < N; r++) if (s.cand[idx(N, r, c)] === 1) cells.push(idx(N, r, c));
      if (cells.length) pushSlot(cells);
    }
  } else {
    // region
    for (let g = 0; g < N; g++) {
      let placed = false;
      const cells = [];
      for (const i of s.regionCells[g]) {
        if (s.cand[i] === 2) placed = true;
        else if (s.cand[i] === 1) cells.push(i);
      }
      if (!placed && cells.length) pushSlot(cells);
    }
  }
  return out;
}

// Run one pairing; return "2" (confinement, k=1) or "3" (subset, k>=2) if it
// eliminated any candidate, else false.
function subsetPairing(s, slotType, valueType) {
  const slots = slotsFor(s, slotType, valueType);
  const n = slots.length;
  const valueOf = (i) =>
    valueType === "col" ? i % s.N : valueType === "row" ? Math.floor(i / s.N) : s.regionOf[i];

  for (let k = 1; k <= Math.min(4, n - 1); k++) {
    const combo = [];
    let hit = null;
    const rec = (start, orMask) => {
      if (combo.length === k) {
        if (popcount(orMask) === k) hit = { set: [...combo], mask: orMask };
        return;
      }
      for (let i = start; i < n && !hit; i++) {
        const nm = orMask | slots[i].mask;
        if (popcount(nm) > k) continue;
        combo.push(i);
        rec(i + 1, nm);
        combo.pop();
      }
    };
    rec(0, 0);
    if (!hit) continue;

    const inSet = new Set(hit.set);
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (inSet.has(i)) continue;
      for (const cell of slots[i].cells) {
        if (s.cand[cell] === 1 && hit.mask & (1 << valueOf(cell))) {
          s.cand[cell] = 0;
          changed = true;
        }
      }
    }
    if (changed) return k === 1 ? "2" : "3";
  }
  return false;
}

const PAIRINGS = [
  ["row", "col"],
  ["col", "row"],
  ["region", "row"],
  ["region", "col"],
  ["row", "region"],
  ["col", "region"],
];

// Tier 2/3 combined: try every pairing, return the tier of the first that fires.
function tier23(s) {
  for (const [slot, val] of PAIRINGS) {
    const r = subsetPairing(s, slot, val);
    if (r) return r;
  }
  return false;
}

// --- Tier 4: depth-1 trial (contradiction elimination) ---
function tier4(s) {
  const { N } = s;
  for (let r = 0; r < N; r++) {
    if (s.placedRow[r] !== -1) continue;
    for (let c = 0; c < N; c++) {
      if (s.cand[idx(N, r, c)] !== 1) continue;
      const t = cloneState(s);
      place(t, r, c);
      propagateBasic(t); // tiers 1-3 to fixpoint, no further trial
      if (contradicts(t)) {
        s.cand[idx(N, r, c)] = 0; // this cell is impossible
        return "4";
      }
    }
  }
  return false;
}

// Apply tiers 1-3 until no progress (used inside trial).
function propagateBasic(s) {
  let progress = true;
  while (progress) {
    progress = false;
    if (tier1(s)) {
      progress = true;
      continue;
    }
    if (tier23(s)) {
      progress = true;
      continue;
    }
  }
}

// Grade a puzzle: returns { solved, maxTier, tierCounts }.
// `maxTierAllowed` caps which techniques may be used; e.g. 3 skips the expensive
// trial tier entirely, so a puzzle that needs guessing returns solved:false fast.
export function grade(puzzle, maxTierAllowed = 4) {
  const s = makeState(puzzle);
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let maxTier = 0;
  let steps = 0;
  const guard = puzzle.N * puzzle.N * 20;
  while (s.placedCount < s.N && steps++ < guard) {
    const t = tier1(s) || tier23(s) || (maxTierAllowed >= 4 && tier4(s));
    if (!t) break;
    const tier = Number(t);
    tierCounts[tier]++;
    if (tier > maxTier) maxTier = tier;
    if (contradicts(s)) return { solved: false, maxTier, tierCounts };
  }
  return { solved: s.placedCount === s.N, maxTier, tierCounts };
}
