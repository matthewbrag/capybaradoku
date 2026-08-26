// Shared scoreboard via Supabase's auto-generated REST API (PostgREST).
// Dependency-free: just fetch() with the public anon key. Row-Level Security on
// the table is what actually controls access, so the anon key is safe to ship.
//
// SETUP: paste your project's URL and anon (public) key below. Until you do,
// isConfigured() is false and the app quietly runs with the local score only.

const SUPABASE_URL = "https://hxyfzcxplopjpspltngm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_VNEtqrr9fHTi7hvc7_FNmw_8JtVn0DD";

const CONFIGURED = !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR-ANON");

export function isConfigured() {
  return CONFIGURED;
}

const headers = () => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
});

// Upsert this player's row, keyed on their stable per-device `id` (not their
// name) so renaming updates the same row instead of creating a duplicate.
export async function submitScore(id, name, score, bestLevel) {
  if (!CONFIGURED || !id || !name) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/scores?on_conflict=id`, {
      method: "POST",
      headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id, name, score, best_level: bestLevel, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false; // offline or blocked — non-fatal
  }
}

// Fetch the top `limit` rows, highest score first.
export async function fetchTop(limit = 20) {
  if (!CONFIGURED) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/scores?select=id,name,score,best_level&order=score.desc&limit=${limit}`,
      { headers: headers() }
    );
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}
