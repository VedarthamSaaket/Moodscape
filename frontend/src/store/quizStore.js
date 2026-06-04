// Quiz store, independent of useStudioStore so quiz history persists separately.
// Zustand v5 with localStorage persist (key: 'moodscape-quiz') AND backend
// persistence via /api/quiz/result (PUT on completion, GET on hydrate).
//
// Shape:
//   answers          Array<{questionId, optionId, delta}>   in question order
//   scores           {temp, edge, era, density}             aggregate after submit
//   archetype        ARCHETYPES element  | null
//   runnerUp         ARCHETYPES element  | null
//   completedAt      ISO timestamp       | null
//   hydratedFromServer bool                                 prevents duplicate fetches
//   pendingStyleSeed {archetype, vibePrompt, genres} | null
//     set by "Use my style in the next playlist". GeneratorPage reads + clears
//     it on mount.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { API_BASE } from '../config';
import { ARCHETYPES } from '../pages/quiz/quizData.js';

const authHeaders = () => {
  const token =
    (typeof localStorage !== 'undefined') && localStorage.getItem('authToken');
  return token
    ? { 'Content-Type': 'application/json', 'X-Session-Token': token }
    : null;
};

// Look up the full archetype object by id (server only stores the id).
const findArchetype = (id) =>
  (id && ARCHETYPES.find((a) => a.id === id)) || null;

// Best-effort background PUT so the result survives across devices.
function pushResult(state) {
  const headers = authHeaders();
  if (!headers || !state.archetype) return;
  const body = {
    archetype_id:   state.archetype.id,
    archetype_name: state.archetype.name,
    runner_up_id:   state.runnerUp?.id || null,
    runner_up_name: state.runnerUp?.name || null,
    scores:         state.scores || { temp: 0, edge: 0, era: 0, density: 0 },
    answers:        state.answers || [],
    completed_at:   state.completedAt || new Date().toISOString(),
  };
  fetch(`${API_BASE}/api/quiz/result`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  }).catch(() => { /* keep local copy if network fails */ });
}

function pushDelete() {
  const headers = authHeaders();
  if (!headers) return;
  fetch(`${API_BASE}/api/quiz/result`, {
    method: 'DELETE',
    headers,
  }).catch(() => {});
}

const useQuizStore = create(
  persist(
    (set, get) => ({
      answers: [],
      scores: null,
      archetype: null,
      runnerUp: null,
      completedAt: null,
      hydratedFromServer: false,
      pendingStyleSeed: null,

      // Save a single answer mid-quiz. If the user goes back and changes
      // their pick, overwrite the existing entry for that questionId.
      recordAnswer: (questionId, option) =>
        set((s) => {
          const next = s.answers.filter((a) => a.questionId !== questionId);
          next.push({
            questionId,
            optionId: option.id,
            delta: option.delta,
          });
          return { answers: next };
        }),

      // Finalize quiz, store scoring output, timestamp, and push to backend.
      finalize: ({ scores, archetype, runnerUp }) => {
        const completedAt = new Date().toISOString();
        set({ scores, archetype, runnerUp, completedAt });
        pushResult({
          scores,
          archetype,
          runnerUp,
          completedAt,
          answers: get().answers,
        });
      },

      // Wipe everything for a retake (locally AND on the server).
      reset: () => {
        set({
          answers: [],
          scores: null,
          archetype: null,
          runnerUp: null,
          completedAt: null,
        });
        pushDelete();
      },

      // Pull the user's saved result on app load. Server is the source of
      // truth, local cache only acts as offline fallback. No-op if logged out.
      hydrateFromServer: async () => {
        const headers = authHeaders();
        if (!headers) return;
        if (get().hydratedFromServer) return;
        try {
          const res = await fetch(`${API_BASE}/api/quiz/result`, { headers });
          if (!res.ok) return;
          const data = await res.json();
          const result = data?.result;
          if (!result) {
            // Server says no saved quiz, mark hydrated and keep any local progress.
            set({ hydratedFromServer: true });
            return;
          }
          const archetype = findArchetype(result.archetype_id);
          const runnerUp  = findArchetype(result.runner_up_id);
          if (!archetype) {
            set({ hydratedFromServer: true });
            return;
          }
          set({
            scores:      result.scores || null,
            archetype,
            runnerUp,
            answers:     Array.isArray(result.answers) ? result.answers : [],
            completedAt: result.completed_at || null,
            hydratedFromServer: true,
          });
        } catch {
          // Network down, keep local copy.
        }
      },

      resetHydration: () => set({ hydratedFromServer: false }),

      // "Use my style in the next playlist", GeneratorPage reads then calls clearPendingStyleSeed.
      setPendingStyleSeed: (seed) => set({ pendingStyleSeed: seed }),
      clearPendingStyleSeed: () => set({ pendingStyleSeed: null }),
    }),
    { name: 'moodscape-quiz' }
  )
);

export default useQuizStore;
