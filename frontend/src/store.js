import { create } from "zustand";
import { persist } from "zustand/middleware";

const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function makeBoard(name = "My First Board") {
  return {
    id: uid(),
    name,
    layout: "freeform",
    cards: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const initialBoards = [makeBoard()];

const useStudioStore = create(
  persist(
    (set, get) => ({
      boards: initialBoards,
      activeBoardId: initialBoards[0].id,

      setActiveBoardId: (id) => set({ activeBoardId: id }),

      getActiveBoard: () => {
        const { boards, activeBoardId } = get();
        return boards.find((b) => b.id === activeBoardId) || boards[0];
      },

      addBoard: (board) =>
        set((s) => ({
          boards: [...s.boards, board],
          activeBoardId: board.id,
        })),

      updateBoard: (board) =>
        set((s) => ({
          boards: s.boards.map((b) =>
            b.id === board.id ? { ...board, updated_at: new Date().toISOString() } : b
          ),
        })),

      deleteBoard: (id) =>
        set((s) => {
          const next = s.boards.filter((b) => b.id !== id);
          const newActive = next.length ? next[0].id : null;
          return { boards: next.length ? next : [makeBoard()], activeBoardId: newActive || next[0]?.id };
        }),

      // Quiz fingerprint — stores shape results
      fingerprint: null,
      savedShapes: [],

      setFingerprint: (fp) => set({ fingerprint: fp }),
      addSavedShape: (shape) =>
        set((s) => ({ savedShapes: [...s.savedShapes, shape] })),
    }),
    { name: "moodscape-studio" }
  )
);

export default useStudioStore;
