import React from 'react';
import useSavedStore from '../store/savedStore';
import usePlayerStore from '../store/playerStore';
import './SavedPage.css';

export default function SavedPage() {
  const saved       = useSavedStore((s) => s.saved);
  const removeSaved = useSavedStore((s) => s.removeSaved);
  const clearSaved  = useSavedStore((s) => s.clearSaved);
  const playList    = usePlayerStore((s) => s.playList);

  return (
    <div className="saved-page">
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

      {saved.length === 0 ? (
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
    </div>
  );
}
