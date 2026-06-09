import { create } from "zustand";
import { persist } from "zustand/middleware";
import { API_BASE } from "./config";

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

// ── Sync helpers ────────────────────────────────────────────────────────────
// Backend persistence is "best effort, last-write-wins". The local Zustand
// store remains the source of truth for the UI, backend pushes happen async
// in the background. If the user is logged out (no token), we silently skip.

const authHeaders = () => {
  const token = (typeof localStorage !== "undefined") && localStorage.getItem("authToken");
  return token
    ? { "Content-Type": "application/json", "X-Session-Token": token }
    : null;
};

// Debounce per-board so rapid keystrokes (e.g. typing in a text card) only
// trigger one PUT per ~700ms.
const pushTimers = new Map();
function schedulePush(board) {
  const headers = authHeaders();
  if (!headers) return;
  const existing = pushTimers.get(board.id);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    pushTimers.delete(board.id);
    fetch(`${API_BASE}/api/boards/${encodeURIComponent(board.id)}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(board),
    }).catch(() => { /* swallow; localStorage already has it */ });
  }, 700);
  pushTimers.set(board.id, t);
}

function pushDelete(boardId) {
  const headers = authHeaders();
  if (!headers) return;
  fetch(`${API_BASE}/api/boards/${encodeURIComponent(boardId)}`, {
    method: "DELETE",
    headers,
  }).catch(() => {});
}

const useStudioStore = create(
  persist(
    (set, get) => ({
      boards: initialBoards,
      activeBoardId: initialBoards[0].id,
      hydratedFromServer: false,

      setActiveBoardId: (id) => set({ activeBoardId: id }),

      getActiveBoard: () => {
        const { boards, activeBoardId } = get();
        return boards.find((b) => b.id === activeBoardId) || boards[0];
      },

      addBoard: (board) => {
        set((s) => ({
          boards: [...s.boards, board],
          activeBoardId: board.id,
        }));
        schedulePush(board);
      },

      updateBoard: (board) => {
        const stamped = { ...board, updated_at: new Date().toISOString() };
        set((s) => ({
          boards: s.boards.map((b) => (b.id === stamped.id ? stamped : b)),
        }));
        schedulePush(stamped);
      },

      deleteBoard: (id) =>
        set((s) => {
          const next = s.boards.filter((b) => b.id !== id);
          const fallback = next.length ? next : [makeBoard()];
          const newActive = next.length ? next[0].id : fallback[0].id;
          pushDelete(id);
          return { boards: fallback, activeBoardId: newActive };
        }),

      // Fingerprint (used by the older Mirror flow, kept for back-compat with StudioPage)
      fingerprint: null,
      savedShapes: [],
      setFingerprint: (fp) => set({ fingerprint: fp }),
      addSavedShape: (shape) =>
        set((s) => ({ savedShapes: [...s.savedShapes, shape] })),

      // ── Server hydrate ────────────────────────────────────────────────
      // Called once after sign-in (or once on app start if already signed in).
      // POSTs local boards → /api/boards/sync, then replaces the local list
      // with the server's authoritative union (last-write-wins per board).
      hydrateFromServer: async () => {
        const headers = authHeaders();
        if (!headers) return;
        if (get().hydratedFromServer) return;
        try {
          const { boards } = get();
          // Skip pushing the placeholder "My First Board" if it has no cards.
          const toSend = boards.filter(
            (b) => !(b.name === "My First Board" && (b.cards?.length ?? 0) === 0)
          );
          const res = await fetch(`${API_BASE}/api/boards/sync`, {
            method: "POST",
            headers,
            body: JSON.stringify({ boards: toSend }),
          });
          if (!res.ok) return;
          const data = await res.json();
          const merged = Array.isArray(data.boards) ? data.boards : [];
          if (merged.length === 0) {
            // Server has nothing yet AND we sent nothing, keep the local placeholder.
            set({ hydratedFromServer: true });
            return;
          }
          const stillActive = merged.find((b) => b.id === get().activeBoardId);
          set({
            boards: merged,
            activeBoardId: stillActive ? stillActive.id : merged[0].id,
            hydratedFromServer: true,
          });
        } catch {
          // Network down → keep local state. We'll retry on next mount.
        }
      },

      resetHydration: () => set({ hydratedFromServer: false }),
    }),
    { name: "moodscape-studio" }
  )
);

export default useStudioStore;
