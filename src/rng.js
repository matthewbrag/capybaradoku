// Deterministic PRNG so that "level N" produces the identical puzzle on every
// device. Everything downstream (permutation generation, region flood-fill,
// re-roll search) draws from an instance of this — no Math.random() anywhere in
// generation, or determinism would break.

// mulberry32: tiny, fast, good-enough-quality 32-bit PRNG.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stable string -> 32-bit hash (FNV-1a). Used to turn (level, attempt) into a
// seed. Must never change, or previously-shared level numbers would remap.
export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Convenience helpers built on a mulberry32 instance.
export function makeRng(seedInt) {
  const next = mulberry32(seedInt);
  return {
    next, // float in [0,1)
    int: (n) => Math.floor(next() * n), // int in [0,n)
    shuffle: (arr) => {
      // Fisher-Yates, in place.
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}
