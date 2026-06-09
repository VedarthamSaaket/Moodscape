// Saint-or-Sinner lifetime stats (backend-backed).
//
// Accumulates performance across every run so we can show a persistent "Vibe
// Guesser" meter — a read on how sharply the player judges strangers. Backend
// is the single source of truth (table: saint_stats, /api/saint/*); this store
// mirrors it at runtime, hydrated on load. No localStorage.

import { create } from 'zustand';
import { API_BASE } from '../config';

const authHeaders = () => {
  const token =
    (typeof localStorage !== 'undefined') && localStorage.getItem('authToken');
  return token
    ? { 'Content-Type': 'application/json', 'X-Session-Token': token }
    : null;
};

// The Vibe Guesser score (0..100): mostly how closely your blind verdicts track
// the world's (reading the room from traits alone), with a lighter weight on
// actually naming the figure. It's the "how well you read people" number.
export function vibeScoreOf({ roundsTotal = 0, proximityTotal = 0, guessTotal = 0 } = {}) {
  if (!roundsTotal) return 0;
  const readAccuracy = proximityTotal / roundsTotal;        // 0..100
  const guessRate    = (guessTotal / roundsTotal) * 100;    // 0..100
  return Math.round(readAccuracy * 0.8 + guessRate * 0.2);
}

// Gen-Z flavoured rank that maps to psychological sharpness. Thresholds are
// tuned to the realistic score distribution (reads cluster 55–80).
export function vibeRank(score) {
  if (score >= 85) return { label: 'Certified Mind Reader', tier: 6 };
  if (score >= 75) return { label: 'Aura Whisperer',        tier: 5 };
  if (score >= 66) return { label: 'Sharp Read',            tier: 4 };
  if (score >= 57) return { label: 'Pretty Perceptive',     tier: 3 };
  if (score >= 48) return { label: 'Hit or Miss',           tier: 2 };
  if (score >= 38) return { label: 'Still Calibrating',     tier: 1 };
  return { label: 'Vibe Rookie', tier: 0 };
}

const EMPTY = { runs: 0, roundsTotal: 0, proximityTotal: 0, guessTotal: 0, bestAccuracy: 0 };

const useSaintStore = create((set, get) => ({
  ...EMPTY,
  hydrated: false,

  hydrate: async () => {
    const headers = authHeaders();
    if (!headers || get().hydrated) return;
    try {
      const res = await fetch(`${API_BASE}/api/saint/stats`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data && data.stats) set({ ...data.stats });
      }
    } catch { /* offline — keep whatever is local */ }
    set({ hydrated: true });
  },
  resetHydration: () => set({ ...EMPTY, hydrated: false }),

  // Record one completed run. Optimistic local increment, then reconcile with
  // the server's authoritative totals.
  recordRun: ({ accuracy, guesses, total }) => {
    const acc = Math.round(accuracy);
    set((s) => ({
      runs:           s.runs + 1,
      roundsTotal:    s.roundsTotal + total,
      proximityTotal: s.proximityTotal + acc * total,
      guessTotal:     s.guessTotal + guesses,
      bestAccuracy:   Math.max(s.bestAccuracy, acc),
    }));
    const headers = authHeaders();
    if (headers) {
      fetch(`${API_BASE}/api/saint/record`, {
        method: 'POST', headers,
        body: JSON.stringify({ accuracy: acc, guesses, total }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && d.stats) set({ ...d.stats }); })
        .catch(() => { /* local copy stands until next hydrate */ });
    }
  },
}));

export default useSaintStore;
