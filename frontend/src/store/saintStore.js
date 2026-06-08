// Saint or Sinner — local progress store.
//
// Deliberately frontend-only (localStorage via zustand persist, no backend
// sync): the figures' reputations are static curated data, so there is nothing
// server-side to reconcile. We only remember the player's best run so the intro
// can show a high score. Mirrors the persisted-store idiom used elsewhere in
// the app (see store/quizStore.js) minus the network calls.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useSaintStore = create(
  persist(
    (set) => ({
      bestAccuracy: 0, // best run's average "read the room" accuracy, 0..100
      runs: 0,         // total playthroughs completed

      recordRun: (accuracy) =>
        set((s) => ({
          runs: s.runs + 1,
          bestAccuracy: Math.max(s.bestAccuracy, Math.round(accuracy)),
        })),
    }),
    { name: 'moodscape-sns' }
  )
);

export default useSaintStore;
