// Lofi-radio toggle, lifted to the app root so the stream keeps playing as
// the user navigates between routes. The visible <PixelRadio/> on the Saved
// page and the off-screen audio iframe rendered by <GlobalRadio/> at the app
// root both read/write this single source of truth.
//
// Persisted to localStorage so the user can reload the page and still find
// the radio in the state they left it in.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import usePlayerStore from './playerStore';

// Radio and the music player are mutually exclusive audio sources — only one
// plays at a time. Turning the radio ON pauses the player; the player's own
// effect then calls pauseVideo() on the YouTube iframe. (The reverse direction
// — starting the player turns the radio off — lives in GlobalPlayer.)
const pausePlayerIfPlaying = () => {
  try {
    const ps = usePlayerStore.getState();
    if (ps.isPlaying) ps.setIsPlaying(false);
  } catch { /* player store not ready — nothing to pause */ }
};

const useRadioStore = create(
  persist(
    (set) => ({
      on: false,
      toggle: () =>
        set((s) => {
          const next = !s.on;
          if (next) pausePlayerIfPlaying();
          return { on: next };
        }),
      setOn: (on) => {
        const next = !!on;
        if (next) pausePlayerIfPlaying();
        set({ on: next });
      },
    }),
    { name: 'moodscape-radio' },
  ),
);

export default useRadioStore;
