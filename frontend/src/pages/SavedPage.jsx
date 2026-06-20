import React from 'react';
import useSavedStore from '../store/savedStore';
import usePlayerStore from '../store/playerStore';
import useRadioStore from '../store/radioStore';
import PixelRadio from './saved/PixelRadio.jsx';
import './SavedPage.css';

export default function SavedPage() {
  const saved        = useSavedStore((s) => s.saved);
  const removeSaved  = useSavedStore((s) => s.removeSaved);
  const clearSaved   = useSavedStore((s) => s.clearSaved);
  const hydrated     = useSavedStore((s) => s.hydrated);
  const hydrating    = useSavedStore((s) => s.hydrating);
  const hydrateError = useSavedStore((s) => s.hydrateError);
  const hydrate      = useSavedStore((s) => s.hydrate);
  const playList     = usePlayerStore((s) => s.playList);

  // Global radio state — survives page navigation because the actual audio
  // iframe is hosted by <GlobalRadio/> at the app root, not here.
  const radioOn   = useRadioStore((s) => s.on);
  const toggleRadio = useRadioStore((s) => s.toggle);

  return (
    <div className="saved-page">
      <aside className="saved-radio-col">
        <div className="saved-radio-stack">
          <PixelRadio on={radioOn} onToggle={toggleRadio} />

          <div className="saved-radio-caption">
            <span className="saved-radio-eyebrow">FM · live</span>
            <span className="saved-radio-title">
              {radioOn ? 'now broadcasting' : 'tap to tune in'}
            </span>
            <span className="saved-radio-sub">
              {radioOn ? '24/7 lofi hip hop radio' : 'a little background while you browse'}
            </span>
          </div>
        </div>
      </aside>

      <section className="saved-main">
        <header className="saved-head">
          <div>
            <div className="saved-eyebrow">Your library</div>
            <h1 className="saved-title">Saved Songs</h1>
            <p className="saved-sub">
              {saved.length
                ? `${saved.length} song${saved.length > 1 ? 's' : ''} kept for later`
                : 'Songs you save from the quiz land here.'}
            </p>
          </div>
          {saved.length > 0 && (
            <div className="saved-actions">
              <button className="saved-btn" onClick={() => playList(saved, 0)}>▶ Play all</button>
              <button className="saved-btn saved-btn--ghost" onClick={clearSaved}>Clear all</button>
            </div>
          )}
        </header>

        {saved.length === 0 && hydrateError ? (
          // Pull failed — do NOT show the "no songs yet" empty state, which is
          // indistinguishable from a genuinely empty library. Songs are safe
          // on the server; we just couldn't reach it.
          <div className="saved-empty">
            <span className="saved-empty-glyph">⟳</span>
            <p className="saved-empty-line">Couldn’t sync your saved songs.</p>
            <p className="saved-empty-hint">They’re safe on the server — retrying automatically.</p>
            <button className="saved-btn" style={{ marginTop: 12 }} onClick={() => hydrate(true)}>
              Retry now
            </button>
          </div>
        ) : saved.length === 0 && (hydrating || !hydrated) ? (
          // First pull in flight (or not yet attempted) — show loading, not empty.
          <div className="saved-empty">
            <span className="saved-empty-glyph">♪</span>
            <p className="saved-empty-line">Loading your saved songs…</p>
          </div>
        ) : saved.length === 0 ? (
          <div className="saved-empty">
            <span className="saved-empty-glyph">♡</span>
            <p className="saved-empty-line">No saved songs yet.</p>
            <p className="saved-empty-hint">Take the Quiz and tap ♥ on any suggestion to keep it here.</p>
          </div>
        ) : (
          <ul className="saved-list">
            {saved.map((t, i) => (
              <li className="saved-row" key={`${t.spotifyUrl || t.title}-${i}`}>
                <button
                  className="saved-play"
                  onClick={() => playList(saved, i)}
                  title="Play (and queue the rest)"
                  aria-label={`Play ${t.title}`}
                >▶</button>
                {t.albumArt
                  ? <img className="saved-art" src={t.albumArt} alt="" />
                  : <span className="saved-art saved-art--empty">♪</span>}
                <span className="saved-info">
                  <span className="saved-song-title" title={t.title}>{t.title}</span>
                  <span className="saved-song-artist" title={t.artist}>{t.artist}</span>
                </span>
                {t.spotifyUrl && (
                  <a className="saved-ext" href={t.spotifyUrl} target="_blank" rel="noreferrer" title="Open in Spotify">↗</a>
                )}
                <button
                  className="saved-remove"
                  onClick={() => removeSaved(t)}
                  title="Remove from saved"
                  aria-label="Remove from saved"
                >✕</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
