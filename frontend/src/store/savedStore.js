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
  hydrated: false,      // pulled from server this session

  // Pull the user's saved songs from the server. Source of truth. No-op if
  // logged out or already hydrated this session, unless `force` is true.
  // `force` is set on visibility / focus refreshes so a user returning to
  // the tab always sees the latest server state, even within one session.
  hydrate: async (force = false) => {
    const headers = authHeaders();
    if (!headers) {
      console.warn('[SAVED] hydrate: not logged in');
      return;
    }
    if (!force && get().hydrated) {
      console.log('[SAVED] hydrate: already hydrated this session');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/saved`, { headers });
      if (!res.ok) {
        console.error(`[SAVED] hydrate failed: ${res.status}`);
        return;
      }
      const data = await res.json();
      const songs = Array.isArray(data.saved) ? data.saved : [];
      console.log(`[SAVED] hydrate: fetched ${songs.length} songs`, songs);
      set({ saved: songs, hydrated: true });
    } catch (e) {
      console.error('[SAVED] hydrate network error:', e.message);
    }
  },
  resetHydration: () => set({ saved: [], hydrated: false }),

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
