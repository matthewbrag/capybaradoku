// Capybaradoku — game controller + rendering.
//
// Loads the pre-baked level pack (deterministic, identical on every device),
// renders the colored grid, and runs the Meowdoku rules with a 3-hearts fail
// state. Falls back to on-device generation for levels beyond the pack.

import { generate } from "./generator.js";
import { isConfigured, submitScore, fetchTop } from "./scoreboard.js";

const REGION_COLORS = [
  "#c98a5e", // capybara brown
  "#7fb069", // grass
  "#5ba3c7", // pond blue
  "#e6a15b", // sunset orange
  "#b088c9", // orchid
  "#e28f8f", // clay red
  "#6fc4b0", // teal
  "#d9c26a", // wheat
  "#8fa5d9", // periwinkle
  "#c47fa5", // rose
  "#9db06b", // olive
  "#d79f7a", // tan
];

const CAT = 2; // cell state: a capybara is here
const MARK = 1; // cell state: player's note (blocked)
const EMPTY = 0;

const state = {
  pack: null,
  level: 1,
  N: 0,
  regionOf: null,
  solution: null,
  difficulty: 1,
  cells: null, // Uint8Array of EMPTY/MARK/CAT
  hearts: 3,
  status: "playing", // playing | won | lost
  history: [], // for undo: {i, prev}
  justPlaced: -1, // cell index that should play the placement animation (once)
  lastScore: null, // score breakdown of the most recent win
  lastDelta: 0, // amount added to the lifetime total by the most recent win
  freshWin: false, // true for the single render right after a win (drives the count-up)
};

// --- Scoring: a local "number go up" loop. Tune these freely. ---
const SCORE = {
  base: (N) => 100 + (N - 7) * 20, // 7->100 .. 10->160
  diffMult: { 2: 1, 3: 1.6, 4: 2.5 }, // Easy / Tricky / Fiendish
  heartsMult: { 3: 1.5, 2: 1.0, 1: 0.5 }, // reward flawless solves
  streakStep: 0.2, // each consecutive win adds this to the multiplier
  streakCap: 3, // ...up to 3x
  levelPer: 10, // every N levels...
  levelStep: 0.25, // ...adds this to the multiplier
};

function computeScore(level, N, difficulty, hearts, streak) {
  const base = SCORE.base(N);
  const dm = SCORE.diffMult[difficulty] ?? 1;
  const hm = SCORE.heartsMult[hearts] ?? 0.5;
  const sm = Math.min(SCORE.streakCap, 1 + SCORE.streakStep * Math.max(0, streak - 1));
  const lm = 1 + Math.floor((level - 1) / SCORE.levelPer) * SCORE.levelStep;
  const total = Math.round(base * dm * hm * sm * lm);
  return { total, base, dm, hm, sm, lm, hearts };
}

const $ = (sel) => document.querySelector(sel);
const idx = (N, r, c) => r * N + c;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
const PROGRESS_KEY = "capy.progress.v1";
function loadProgress() {
  const def = { solved: {}, last: 1, lifetime: 0, best: 0, streak: 0, perLevelBest: {} };
  try {
    return { ...def, ...(JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}) };
  } catch {
    return def;
  }
}
function saveProgress(p) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {}
}

// Full in-progress board state, saved per level so closing/reopening the app
// resumes exactly where you left off (not just which level you were on).
const GAMESTATE_KEY = "capy.gamestate.v1";
function loadAllGameState() {
  try {
    return JSON.parse(localStorage.getItem(GAMESTATE_KEY)) || {};
  } catch {
    return {};
  }
}
function saveGameState() {
  try {
    const all = loadAllGameState();
    all[state.level] = {
      cells: Array.from(state.cells),
      hearts: state.hearts,
      status: state.status,
      history: state.history,
    };
    localStorage.setItem(GAMESTATE_KEY, JSON.stringify(all));
  } catch {}
}
function clearGameState(level) {
  try {
    const all = loadAllGameState();
    delete all[level];
    localStorage.setItem(GAMESTATE_KEY, JSON.stringify(all));
  } catch {}
}

// Stable per-device player id — the scoreboard is keyed on this, so changing
// your display name updates your existing row instead of making a new one.
const PLAYER_ID_KEY = "capy.playerId.v1";
function getPlayerId() {
  try {
    let id = localStorage.getItem(PLAYER_ID_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(PLAYER_ID_KEY, id);
    }
    return id;
  } catch {
    return `anon-${Math.random().toString(36).slice(2)}`;
  }
}

// Player display name for the shared scoreboard.
const NAME_KEY = "capy.name.v1";
function getName() {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
}
function setName(n) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {}
}
function highestSolvedLevel(prog) {
  const keys = Object.keys(prog.solved || {}).map(Number);
  return keys.length ? Math.max(...keys) : 0;
}

// ---------------------------------------------------------------------------
// Level loading
// ---------------------------------------------------------------------------
function decodeRegions(str, N) {
  const arr = new Int16Array(N * N);
  for (let i = 0; i < str.length; i++) arr[i] = parseInt(str[i], 36);
  return arr;
}

function getLevel(level) {
  const entry = state.pack.levels.find((l) => l.level === level);
  if (entry) {
    return {
      N: entry.N,
      regionOf: decodeRegions(entry.regions, entry.N),
      solution: entry.solution,
      difficulty: entry.difficulty,
    };
  }
  // Beyond the baked pack: generate on device (deterministic fallback).
  const p = generate(level, { maxAttempts: 300 });
  if (!p) return null;
  return { N: p.N, regionOf: p.regionOf, solution: p.solution, difficulty: p.difficulty };
}

function startLevel(level, { fresh = false } = {}) {
  const lv = getLevel(level);
  if (!lv) return;
  state.level = level;
  state.N = lv.N;
  state.regionOf = lv.regionOf;
  state.solution = lv.solution;
  state.difficulty = lv.difficulty;
  state.cells = new Uint8Array(lv.N * lv.N);
  state.hearts = 3;
  state.status = "playing";
  state.history = [];
  state.justPlaced = -1;

  if (fresh) {
    clearGameState(level);
  } else {
    // Resume a previously-saved board for this level, if any.
    const saved = loadAllGameState()[level];
    if (saved && Array.isArray(saved.cells) && saved.cells.length === lv.N * lv.N) {
      state.cells = Uint8Array.from(saved.cells);
      state.hearts = saved.hearts ?? 3;
      state.status = saved.status || "playing";
      state.history = Array.isArray(saved.history) ? saved.history : [];
    }
  }

  const prog = loadProgress();
  prog.last = level;
  saveProgress(prog);
  render();
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
// Return the set of cell indices that are in conflict (part of a rule
// violation) among currently-placed cats.
function conflicts() {
  const { N, cells, regionOf } = state;
  const cats = [];
  for (let i = 0; i < N * N; i++) if (cells[i] === CAT) cats.push(i);
  const bad = new Set();
  for (let a = 0; a < cats.length; a++) {
    for (let b = a + 1; b < cats.length; b++) {
      const ia = cats[a],
        ib = cats[b];
      const ra = Math.floor(ia / N),
        ca = ia % N;
      const rb = Math.floor(ib / N),
        cb = ib % N;
      const sameRow = ra === rb;
      const sameCol = ca === cb;
      const sameReg = regionOf[ia] === regionOf[ib];
      const adjacent = Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1;
      if (sameRow || sameCol || sameReg || adjacent) {
        bad.add(ia);
        bad.add(ib);
      }
    }
  }
  return bad;
}

function isWon() {
  const { N, cells } = state;
  let count = 0;
  for (let i = 0; i < N * N; i++) if (cells[i] === CAT) count++;
  return count === N && conflicts().size === 0;
}

// Cycle a cell empty -> mark -> cat -> empty. Placing a cat that creates a NEW
// conflict costs a heart.
function tapCell(i) {
  if (state.status !== "playing") return;
  const prev = state.cells[i];
  let next;
  if (prev === EMPTY) next = MARK;
  else if (prev === MARK) next = CAT;
  else next = EMPTY;

  state.history.push({ i, prev });
  state.cells[i] = next;
  // Only a freshly-placed capybara should animate; clear otherwise so the whole
  // board doesn't replay the pop animation on every re-render.
  state.justPlaced = next === CAT ? i : -1;

  if (next === CAT) {
    // Did placing this cat create a conflict it is part of?
    const bad = conflicts();
    if (bad.has(i)) {
      state.hearts--;
      if (state.hearts <= 0) state.status = "lost";
      buzz();
      // A single mistake breaks the streak — the multiplier only rewards clean
      // (flawless) runs. You can still finish the level, just not extend it.
      const prog = loadProgress();
      prog.streak = 0;
      saveProgress(prog);
    }
  }

  if (state.status === "playing" && isWon()) {
    state.status = "won";
    const prog = loadProgress();
    prog.streak = (prog.streak || 0) + 1;
    const sc = computeScore(state.level, state.N, state.difficulty, state.hearts, prog.streak);
    // Anti-farming: only the improvement over this level's previous best counts
    // toward the lifetime total, so you can't grind an easy level for points.
    const prevBest = prog.perLevelBest[state.level] || 0;
    const delta = Math.max(0, sc.total - prevBest);
    prog.lifetime = (prog.lifetime || 0) + delta;
    prog.perLevelBest[state.level] = Math.max(prevBest, sc.total);
    prog.best = Math.max(prog.best || 0, sc.total);
    prog.solved[state.level] = true;
    prog.last = state.level;
    saveProgress(prog);
    state.lastScore = sc;
    state.lastDelta = delta;
    state.freshWin = true;
    cheer();
    // The shared-board submit + display happens in loadOverlayBoard() during the
    // win render, so the player's just-earned score is reflected in the board
    // they see. It's fully best-effort and skipped when offline/unconfigured.
  }
  saveGameState();
  render();
}

function undo() {
  if (state.status === "lost" || !state.history.length) return;
  const { i, prev } = state.history.pop();
  state.cells[i] = prev;
  state.justPlaced = -1; // undo never animates
  if (state.status === "won") state.status = "playing";
  saveGameState();
  render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const DIFF_NAMES = { 1: "Gentle", 2: "Easy", 3: "Tricky", 4: "Fiendish" };

function render() {
  const { N } = state;
  const bad = conflicts();
  const board = $("#board");
  board.style.setProperty("--n", N);
  board.innerHTML = "";

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = idx(N, r, c);
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.style.background = REGION_COLORS[state.regionOf[i] % REGION_COLORS.length];
      // draw thick borders between different regions
      if (c === 0 || state.regionOf[i] !== state.regionOf[idx(N, r, c - 1)]) cell.classList.add("bl");
      if (c === N - 1 || state.regionOf[i] !== state.regionOf[idx(N, r, c + 1)]) cell.classList.add("br");
      if (r === 0 || state.regionOf[i] !== state.regionOf[idx(N, r - 1, c)]) cell.classList.add("bt");
      if (r === N - 1 || state.regionOf[i] !== state.regionOf[idx(N, r + 1, c)]) cell.classList.add("bb");

      const s = state.cells[i];
      if (s === CAT) {
        cell.innerHTML = CAPY_IMG;
        cell.classList.add("cat");
        if (i === state.justPlaced) cell.classList.add("placed"); // animate once
        if (bad.has(i)) cell.classList.add("bad");
      } else if (s === MARK) {
        cell.textContent = "·";
        cell.classList.add("mark");
      }
      cell.addEventListener("click", () => tapCell(i));
      board.appendChild(cell);
    }
  }

  // HUD
  $("#level-label").textContent = `Level ${state.level}`;
  $("#diff-label").textContent = DIFF_NAMES[state.difficulty] + ` · ${N}×${N}`;
  $("#hearts").textContent = "❤️".repeat(state.hearts) + "🖤".repeat(3 - state.hearts);
  const prog = loadProgress();
  $("#solved-flag").style.display = prog.solved[state.level] ? "inline" : "none";

  // score HUD
  $("#streak").textContent = prog.streak > 1 ? `🔥 ×${prog.streak}` : "";
  const scoreEl = $("#score");
  if (state.freshWin) {
    // roll the lifetime total up by the amount just earned
    animateNumber(scoreEl, prog.lifetime - state.lastDelta, prog.lifetime, 700);
  } else {
    scoreEl.textContent = fmt(prog.lifetime);
  }

  const overlay = $("#overlay");
  if (state.status === "won") {
    overlay.style.display = "flex";
    $("#overlay-title").textContent = state.hearts === 3 ? "Flawless! 🎉" : "Solved! 🎉";
    $("#overlay-msg").textContent = `Level ${state.level} complete.`;
    $("#overlay-next").style.display = "inline-block";
    $("#overlay-score").innerHTML = scoreBreakdownHTML(state.lastScore, state.lastDelta, prog.streak);
    if (state.freshWin) {
      const gained = $("#gained");
      if (gained) animateNumber(gained, 0, state.lastScore.total, 700, "+");
    }
    loadOverlayBoard(); // async; submits + shows the mini leaderboard (offline-safe)
  } else if (state.status === "lost") {
    overlay.style.display = "flex";
    $("#overlay-title").textContent = "Out of hearts 💔";
    $("#overlay-msg").textContent = "Give it another go — same puzzle.";
    $("#overlay-next").style.display = "none";
    $("#overlay-score").innerHTML = "";
    $("#overlay-board").style.display = "none";
  } else {
    overlay.style.display = "none";
  }

  state.justPlaced = -1; // one-shot: only the render right after a placement animates
  state.freshWin = false; // one-shot: the count-up plays only on the winning render
}

// Win-screen mini leaderboard. Submits the player's fresh score, then shows the
// top few. Fully offline-safe: if unconfigured, offline, or the fetch fails, the
// section simply doesn't render and the win screen is unaffected.
async function loadOverlayBoard() {
  const el = $("#overlay-board");
  if (!el) return;
  el.style.display = "none";
  if (!isConfigured() || !navigator.onLine) return;

  const name = getName();
  const prog = loadProgress();
  if (name) await submitScore(getPlayerId(), name, prog.lifetime, highestSolvedLevel(prog));

  const rows = await fetchTop(5);
  if (!rows.length) return; // offline/empty/error -> stay hidden

  const me = getPlayerId();
  el.innerHTML =
    `<div class="ob-title">🏆 Leaderboard</div>` +
    rows
      .map((r, i) => {
        const mine = r.id === me ? " mine" : "";
        return `<div class="ob-row${mine}"><span class="lb-rank">${i + 1}</span><span class="lb-name">${escapeHTML(
          r.name
        )}</span><span class="lb-score">${fmt(r.score)}</span></div>`;
      })
      .join("") +
    (name ? "" : `<div class="ob-hint">Tap 🏆 below to add your name</div>`);
  el.style.display = "block";
}

// Build the win-overlay score breakdown (base × multipliers = solve score).
function scoreBreakdownHTML(sc, delta, streak) {
  if (!sc) return "";
  const rows = [
    ["Base", `${sc.base}`],
    ["Difficulty", `×${sc.dm}`],
    [sc.hearts === 3 ? "Flawless" : "Hearts", `×${sc.hm}`],
    ["Streak", `×${sc.sm.toFixed(1)}`],
    ["Level", `×${sc.lm.toFixed(2)}`],
  ];
  const list = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join("");
  const deltaNote = delta < sc.total ? `<div class="delta-note">+${fmt(delta)} to your total (best so far)</div>` : "";
  return `<div class="gained">+<span id="gained">0</span></div>
    <div class="breakdown">${list}</div>${deltaNote}`;
}

// Thousands-separated formatting.
function fmt(n) {
  return Math.round(n).toLocaleString("en-US");
}

// Animate a number element from -> to over ms (optional prefix).
function animateNumber(el, from, to, ms, prefix = "") {
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out
    el.textContent = prefix + fmt(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function buzz() {
  if (navigator.vibrate) navigator.vibrate(80);
}
function cheer() {
  if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
}

// Capybara board token.
const CAPY_IMG = `<img src="./assets/capybara.png" alt="capybara" draggable="false" />`;

// ---------------------------------------------------------------------------
// Wire up UI
// ---------------------------------------------------------------------------
async function init() {
  state.pack = await fetch("./src/levels.json").then((r) => r.json());
  const prog = loadProgress();
  startLevel(prog.last || 1);

  $("#undo").addEventListener("click", undo);
  $("#reset").addEventListener("click", () => startLevel(state.level, { fresh: true }));
  $("#overlay-next").addEventListener("click", () => startLevel(state.level + 1));
  $("#overlay-retry").addEventListener("click", () => startLevel(state.level, { fresh: true }));

  // Leaderboard: hide the button entirely until a backend is configured.
  const lbBtn = $("#leaderboard-btn");
  if (isConfigured()) {
    lbBtn.addEventListener("click", openLeaderboard);
    $("#lb-close").addEventListener("click", () => ($("#leaderboard").style.display = "none"));
    $("#lb-name-save").addEventListener("click", saveNameAndSubmit);
  } else {
    lbBtn.style.display = "none";
  }

  // register service worker for offline / installable PWA
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Leaderboard modal
// ---------------------------------------------------------------------------
async function openLeaderboard() {
  const modal = $("#leaderboard");
  modal.style.display = "flex";
  $("#lb-name").value = getName();
  const list = $("#lb-list");
  list.innerHTML = `<div class="lb-loading">Loading…</div>`;
  const rows = await fetchTop(20);
  const me = getPlayerId();
  if (!rows.length) {
    list.innerHTML = `<div class="lb-loading">No scores yet — be the first!</div>`;
    return;
  }
  list.innerHTML = rows
    .map((r, i) => {
      const mine = r.id === me ? " mine" : "";
      return `<div class="lb-row${mine}">
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${escapeHTML(r.name)}</span>
        <span class="lb-lvl">Lv ${r.best_level ?? "-"}</span>
        <span class="lb-score">${fmt(r.score)}</span>
      </div>`;
    })
    .join("");
}

async function saveNameAndSubmit() {
  const input = $("#lb-name");
  const name = input.value.trim().slice(0, 20);
  if (!name) return;
  setName(name);
  const prog = loadProgress();
  await submitScore(getPlayerId(), name, prog.lifetime, highestSolvedLevel(prog));
  openLeaderboard(); // refresh with the player's row now present/highlighted
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

init();
