// Saved songs the user keeps to replay later. Backend is the single source of
// truth (table: saved_songs, endpoints under /api/saved) — this store holds a
// runtime mirror only, hydrated from the server on load. No localStorage.
//
// Tracks are kept in the player's track-ish shape ({title, artist, albumArt,
// spotifyUrl}) so they can be handed straight to the GlobalPlayer queue.

import { create } from 'zustand';
import { API_BASE } from '../config';

// Stable identity for a track: prefer the Spotify URL, fall back to title·artist.
export const savedKey = (t) =>
  (t && (t.spotifyUrl || `${t.title || ''}·${t.artist || ''}`)) || '';

const authHeaders = () => {
  const token =
    (typeof localStorage !== 'undefined') && localStorage.getItem('authToken');
  return token
    ? { 'Content-Type': 'application/json', 'X-Session-Token': token }
    : null;
};

const useSavedStore = create((set, get) => ({
  saved: [],            // [{ title, artist, albumArt, spotifyUrl }], newest first
  hydrated: false,      // a server pull SUCCEEDED this session (authoritative)
  hydrating: false,     // a pull is in flight (race guard for the mount + focus effects)
  hydrateError: false,  // last pull failed — UI shows "couldn't sync" instead of empty state

  // Pull the user's saved songs from the server. Server is the single source
  // of truth, so a reload always re-pulls. No-op if logged out, or if a
  // SUCCESSFUL pull already happened this session (unless `force`), or if a
  // pull is already in flight.
  //
  // Critical: a failed pull must NEVER set `hydrated:true`. Caching a failure
  // as success was the disappearing-saves bug — the line-37 guard then pinned
  // the empty list for the rest of the session. On failure we leave `hydrated`
  // false so the focus/visibility refresh (or the next navigation) retries.
  hydrate: async (force = false) => {
    const headers = authHeaders();
    if (!headers) {
      console.warn('[SAVED] hydrate: not logged in');
      return;
    }
    if (!force && get().hydrated) return;     // already have an authoritative copy
    if (get().hydrating) return;              // another pull is in flight — don't race it
    set({ hydrating: true });
    try {
      const res = await fetch(`${API_BASE}/api/saved`, { headers });
      if (!res.ok) throw new Error(`hydrate failed: ${res.status}`);
      const data = await res.json();
      const songs = Array.isArray(data.saved) ? data.saved : [];
      console.log(`[SAVED] hydrate: fetched ${songs.length} songs`);
      set({ saved: songs, hydrated: true, hydrateError: false });
    } catch (e) {
      // Do NOT touch `saved` and do NOT set `hydrated` — leave both alone so a
      // later forced refresh retries cleanly instead of locking in an empty list.
      console.error('[SAVED] hydrate error:', e.message);
      set({ hydrateError: true });
    } finally {
      set({ hydrating: false });
    }
  },
  resetHydration: () => set({ saved: [], hydrated: false, hydrating: false, hydrateError: false }),

  isSaved: (t) => {
    const k = savedKey(t);
    return get().saved.some((x) => savedKey(x) === k);
  },

  toggleSave: async (t) => {
    const k = savedKey(t);
    if (get().saved.some((x) => savedKey(x) === k)) {
      await get().removeSaved(t);
      return;
    }
    const clean = {
      title:      t.title || 'Unknown',
      artist:     t.artist || '',
      albumArt:   t.albumArt || null,
      spotifyUrl: t.spotifyUrl || null,
    };
    const headers = authHeaders();
    if (!headers) {
      console.warn('[SAVED] Not logged in, would add local copy (lasts this session only)');
      set((s) => ({ saved: [clean, ...s.saved.filter((x) => savedKey(x) !== k)] }));
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/saved/add`, {
        method: 'POST', headers, body: JSON.stringify(clean),
      });
      if (!res.ok) {
        console.error(`[SAVED] add failed: ${res.status} ${res.statusText}`, await res.text());
        return;
      }
      console.log('[SAVED] add OK, updating local state', k);
      set((s) => ({ saved: [clean, ...s.saved.filter((x) => savedKey(x) !== k)] }));
    } catch (e) {
      console.error('[SAVED] add network error:', e.message);
    }
  },

  removeSaved: async (t) => {
    const k = savedKey(t);
    const headers = authHeaders();
    if (!headers) {
      console.warn('[SAVED] Not logged in, cannot remove');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/saved/remove`, {
        method: 'POST', headers,
        body: JSON.stringify({ title: t.title, artist: t.artist, spotifyUrl: t.spotifyUrl }),
      });
      if (!res.ok) {
        console.error(`[SAVED] remove failed: ${res.status}`);
        return;
      }
      console.log('[SAVED] remove OK, updating local state', k);
      set((s) => ({ saved: s.saved.filter((x) => savedKey(x) !== k) }));
    } catch (e) {
      console.error('[SAVED] remove network error:', e.message);
    }
  },

  clearSaved: () => {
    set({ saved: [] });
    const headers = authHeaders();
    if (headers) {
      fetch(`${API_BASE}/api/saved/clear`, { method: 'POST', headers }).catch(() => {});
    }
  },
}));

export default useSavedStore;
