// Lofi-radio toggle, lifted to the app root so the stream keeps playing as
// the user navigates between routes. The visible <PixelRadio/> on the Saved
// page and the off-screen audio iframe rendered by <GlobalRadio/> at the app
// root both read/write this single source of truth.
//
// Persisted to localStorage so the user can reload the page and still find
// the radio in the state they left it in.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useRadioStore = create(
  persist(
    (set) => ({
      on: false,
      toggle: () => set((s) => ({ on: !s.on })),
      setOn: (on) => set({ on: !!on }),
    }),
    { name: 'moodscape-radio' },
  ),
);

export default useRadioStore;
