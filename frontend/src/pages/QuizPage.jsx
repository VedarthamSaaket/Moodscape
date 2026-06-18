import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useQuizStore from '../store/quizStore.js';
import usePlayerStore from '../store/playerStore.js';
import useSavedStore from '../store/savedStore.js';
import { QUESTIONS, ARCHETYPES } from './quiz/quizData.js';
import { score } from './quiz/scoreQuiz.js';
import VibeMeter from './quiz/VibeMeter.jsx';
import useQuizImages from './quiz/useQuizImages.js';
import { API_BASE } from '../config';
import './QuizPage.css';

// Phases: intro → question(0..N-1) → result
function QuizPage() {
  const navigate = useNavigate();

  // Pre-fetch all 24 tile images on mount, cached in localStorage. The hook
  // returns whatever it has, so cached images render instantly and any
  // missing ones stream in as Unsplash responds.
  const { images: quizImages } = useQuizImages();

  const {
    answers,
    archetype,
    runnerUp,
    scores,
    confidence,
    runnerUpConfidence,
    margin,
    completedAt,
    personalSeed,
    recordAnswer,
    finalize,
    reset,
    setPendingStyleSeed,
    setPersonalSeed,
    setPinnedTracks,
    setQuizStyle,
  } = useQuizStore();

  // Phases: intro → question(0..N-1) → seed → result.
  // If the user has a completed quiz on file, drop straight into the result.
  const [phase, setPhase] = useState(() => (completedAt ? 'result' : 'intro'));
  const [qIdx, setQIdx] = useState(0);
  const [fading, setFading] = useState(false);

  const currentQ = QUESTIONS[qIdx] || null;
  const selectedOption = useMemo(() => {
    if (!currentQ) return null;
    const rec = answers.find((a) => a.questionId === currentQ.id);
    if (!rec) return null;
    return currentQ.options.find((o) => o.id === rec.optionId) || null;
  }, [answers, currentQ]);

  // Transition helper, short cross-fade matching the rest of the app.
  const advance = (next) => {
    setFading(true);
    setTimeout(() => {
      next();
      setFading(false);
    }, 200);
  };

  const handlePick = (option) => {
    if (!currentQ) return;
    recordAnswer(currentQ.id, option);

    if (qIdx === QUESTIONS.length - 1) {
      // Compute final scoring against the FULL answer set (including the answer
      // we just recorded, which isn't yet in `answers` due to React batching).
      const finalAnswers = [
        ...answers.filter((a) => a.questionId !== currentQ.id),
        { questionId: currentQ.id, optionId: option.id, delta: option.delta },
      ];
      const result = score(finalAnswers);
      finalize({
        scores:             result.scores,
        archetype:          result.archetype,
        runnerUp:           result.runnerUp,
        confidence:         result.confidence,
        runnerUpConfidence: result.runnerUpConfidence,
        margin:             result.margin,
      });
      advance(() => setPhase('seed'));
    } else {
      advance(() => setQIdx((i) => i + 1));
    }
  };

  const handleBack = () => {
    if (qIdx === 0) {
      advance(() => setPhase('intro'));
    } else {
      advance(() => setQIdx((i) => i - 1));
    }
  };

  const handleStart = () => {
    reset();
    setQIdx(0);
    advance(() => setPhase('question'));
  };

  const handleRetake = () => {
    reset();
    setQIdx(0);
    advance(() => setPhase('question'));
  };

  const handleUseStyle = () => {
    if (!archetype) return;
    const style = {
      archetype:  archetype.id,
      name:       archetype.name,
      vibePrompt: archetype.vibePrompt,
      genres:     archetype.genreSeed,
    };
    setPendingStyleSeed(style);  // one-shot form prefill
    setQuizStyle(style);         // persistent, survives the Spotify redirect
    navigate('/generator');
  };

  // Sync phase if user navigates back here mid-result.
  useEffect(() => {
    if (phase === 'intro' && completedAt) setPhase('result');
  }, [completedAt, phase]);

  // When a new question (or phase) appears, jump back to the top so the prompt
  // is in view — otherwise you stay scrolled down from the previous options.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [qIdx, phase]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className={`quiz-shell ${fading ? 'fading' : ''}`}>
        {phase === 'intro' && <Intro onStart={handleStart} hasPrior={!!completedAt} onResume={() => setPhase('result')} />}

        {phase === 'question' && currentQ && (
          <QuestionView
            question={currentQ}
            index={qIdx}
            total={QUESTIONS.length}
            selectedId={selectedOption?.id}
            onPick={handlePick}
            onBack={handleBack}
            images={quizImages}
          />
        )}

        {phase === 'seed' && (
          <SeedView
            initial={personalSeed}
            onSubmit={(text) => { setPersonalSeed(text); advance(() => setPhase('result')); }}
            onSkip={() => { setPersonalSeed(''); advance(() => setPhase('result')); }}
          />
        )}

        {phase === 'result' && archetype && (
          <ResultView
            archetype={archetype}
            runnerUp={runnerUp}
            scores={scores}
            confidence={confidence}
            runnerUpConfidence={runnerUpConfidence}
            margin={margin}
            personalSeed={personalSeed}
            onRetake={handleRetake}
            onUseStyle={handleUseStyle}
            onPin={setPinnedTracks}
          />
        )}

        {phase === 'result' && !archetype && (
          <div className="quiz-card">
            <p className="quiz-meta">Something is off, your saved result is missing. Retake the quiz.</p>
            <button className="quiz-btn-primary" onClick={handleStart}>Begin</button>
          </div>
        )}
      </div>
    </>
  );
}

// ── Sub-views ───────────────────────────────────────────────────────────────

function Intro({ onStart, hasPrior, onResume }) {
  return (
    <div className="quiz-intro">
      <div className="quiz-intro-eyebrow">A short, vibes-led quiz</div>
      <h1 className="quiz-intro-title">
        What <em>vibe</em><br />suits you, really?
      </h1>
      <p className="quiz-intro-body">
        Eight quick choices. No right answers. At the end, an aesthetic that fits, and a playlist
        seed shaped for it.
      </p>
      <div className="quiz-intro-actions">
        <button className="quiz-btn-primary" onClick={onStart}>
          {hasPrior ? 'Retake the quiz' : 'Begin'}
        </button>
        {hasPrior && (
          <button className="quiz-btn-ghost" onClick={onResume}>
            See your last result
          </button>
        )}
      </div>
    </div>
  );
}

function SeedView({ initial, onSubmit, onSkip }) {
  const [text, setText] = useState(initial || '');
  return (
    <div className="quiz-intro quiz-seed-step">
      <div className="quiz-intro-eyebrow">One more thing</div>
      <h1 className="quiz-intro-title">
        Name a song or artist<br />you can’t stop returning to.
      </h1>
      <p className="quiz-intro-body">
        Optional, but it lets us hand you songs that sound like <em>you</em>,
        not just your aesthetic.
      </p>
      <input
        className="quiz-seed-input"
        type="text"
        placeholder="e.g. Phoebe Bridgers, or “Night Changes”…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(text.trim()); }}
        maxLength={120}
        autoFocus
      />
      <div className="quiz-intro-actions">
        <button className="quiz-btn-primary" onClick={() => onSubmit(text.trim())}>
          Reveal my vibe
        </button>
        <button className="quiz-btn-ghost" onClick={onSkip}>
          Skip
        </button>
      </div>
    </div>
  );
}

function QuestionView({ question, index, total, selectedId, onPick, onBack, images }) {
  const progress = ((index + 1) / total) * 100;

  return (
    <div className="quiz-question">
      <div className="quiz-progress">
        <span className="quiz-progress-label">{String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
        <div className="quiz-progress-track">
          <div className="quiz-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <h2 className="quiz-question-prompt">{question.prompt}</h2>
      <p className="quiz-question-caption">{question.caption}</p>

      {question.kind === 'tile' ? (
        <div className="quiz-tile-grid">
          {question.options.map((opt, i) => {
            const imgUrl = images?.[`${question.id}::${opt.id}`] || null;
            return (
              <button
                key={opt.id}
                type="button"
                className={`quiz-tile ${selectedId === opt.id ? 'is-selected' : ''}`}
                style={{ '--i': i, '--swatch': opt.swatch }}
                onClick={() => onPick(opt)}
              >
                <span className="quiz-tile-swatch">
                  {imgUrl && (
                    <img
                      className="quiz-tile-img"
                      src={imgUrl}
                      alt=""
                      loading="lazy"
                      draggable={false}
                    />
                  )}
                  <span className="quiz-tile-swatch-tint" aria-hidden />
                </span>
                <span className="quiz-tile-label">{opt.label}</span>
                <span className="quiz-tile-whisper">{opt.whisper}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="quiz-likert-row">
          {question.options.map((opt, i) => (
            <button
              key={opt.id}
              type="button"
              className={`quiz-likert ${selectedId === opt.id ? 'is-selected' : ''}`}
              style={{ '--i': i }}
              onClick={() => onPick(opt)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <div className="quiz-nav-row">
        {index > 0 ? (
          <button className="quiz-btn-ghost" onClick={onBack}>‹ Back</button>
        ) : (
          <button className="quiz-btn-ghost" onClick={onBack}>‹ Restart</button>
        )}
      </div>
    </div>
  );
}

function ResultView({ archetype, runnerUp, scores, confidence, runnerUpConfidence, margin, personalSeed, onRetake, onUseStyle, onPin }) {
  const accent = archetype.accent;
  const gradient = `linear-gradient(110deg, ${accent.from} 0%, ${accent.to} 100%)`;
  const textGradient = {
    backgroundImage: gradient,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  };

  const playList = usePlayerStore((s) => s.playList);
  const saved      = useSavedStore((s) => s.saved);
  const toggleSave = useSavedStore((s) => s.toggleSave);
  const savedSet = useMemo(
    () => new Set(saved.map((t) => t.spotifyUrl || `${t.title}·${t.artist}`)),
    [saved]
  );

  const [suggestions, setSuggestions] = useState([]);
  const [loadingSugg, setLoadingSugg] = useState(true);
  const [suggError, setSuggError]     = useState(false);
  const [selected, setSelected]       = useState(() => new Set()); // by spotifyUrl

  // Fetch 2-3 song suggestions shaped by the archetype + the user's seed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingSugg(true);
      setSuggError(false);
      try {
        const appToken = localStorage.getItem('authToken') || '';
        const res = await fetch(`${API_BASE}/api/quiz/suggestions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Session-Token': appToken },
          body: JSON.stringify({
            archetypeId:   archetype.id,
            archetypeName: archetype.name,
            vibePrompt:    archetype.vibePrompt,
            genreSeed:     archetype.genreSeed,
            languageSeed:  archetype.languageSeed,
            // Archetype-curated Spotify search queries — backend runs these
            // before the generic mood/genre fill so the samples land on the
            // archetype's actual sonic core (e.g. chamber music for Dark
            // Academia rather than an undifferentiated "sad indie" cloud).
            searchSeeds:   archetype.searchSeeds || null,
            personalSeed:  personalSeed || null,
            count:         10,
          }),
        });
        if (!res.ok) throw new Error('bad');
        const data = await res.json();
        if (cancelled) return;
        const tracks = Array.isArray(data.tracks) ? data.tracks : [];
        setSuggestions(tracks);
        // Opt-in: nothing selected by default, the user cherry-picks which
        // songs ride into their next playlist.
        setSelected(new Set());
      } catch {
        if (!cancelled) setSuggError(true);
      } finally {
        if (!cancelled) setLoadingSugg(false);
      }
    })();
    return () => { cancelled = true; };
  }, [archetype, personalSeed]);

  const toggleSelect = (url) => {
    if (!url) return;
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(url)) n.delete(url); else n.add(url);
      return n;
    });
  };

  const handleBuild = () => {
    const picks = suggestions.filter((t) => t.spotifyUrl && selected.has(t.spotifyUrl));
    onPin(picks);   // stage pinned songs for the next playlist (may be empty)
    onUseStyle();   // applies the archetype style seed + routes to the generator
  };

  return (
    <div className="quiz-result">
      <div className="quiz-result-eyebrow">Your style reads as</div>
      <h1 className="quiz-result-name" style={textGradient}>{archetype.name}</h1>

      {runnerUp && (
        <p className="quiz-result-runner">
          with a streak of <span style={textGradient}>{runnerUp.name}</span>
        </p>
      )}

      {Number.isFinite(confidence) && (
        <p className="quiz-result-confidence">
          {(() => {
            const pct = Math.round(confidence * 100);
            const m   = margin ?? 0;
            const label =
              m >= 0.20 ? 'Strong match' :
              m >= 0.08 ? 'Clear lean'   :
                          'Close lean';
            return `${label} · ${pct}% certain`;
          })()}
        </p>
      )}

      <p className="quiz-result-blurb">{archetype.blurb}</p>

      <div className="quiz-meter-wrap">
        <VibeMeter scores={scores} accent={accent} />
      </div>

      <div className="quiz-seed-card">
        <div className="quiz-seed-row">
          <span className="quiz-seed-label">Vibe</span>
          <span className="quiz-seed-value">{archetype.vibePrompt}</span>
        </div>
        <div className="quiz-seed-row">
          <span className="quiz-seed-label">Genres</span>
          <span className="quiz-seed-value">{archetype.genreSeed.join(' · ')}</span>
        </div>
      </div>

      {/* ── Song suggestions ─────────────────────────────────────────────── */}
      <div className="quiz-suggest">
        <div className="quiz-suggest-head">
          <span className="quiz-seed-label">Songs picked for you</span>
          {personalSeed && (
            <span className="quiz-suggest-sub">shaped by your taste + “{personalSeed}”</span>
          )}
        </div>

        {loadingSugg && (
          <div className="quiz-suggest-loading"><span className="quiz-spin-ring" /> finding songs…</div>
        )}

        {suggError && !loadingSugg && (
          <div className="quiz-suggest-error">
            Couldn’t load song picks right now, you can still use your style below.
          </div>
        )}

        {!loadingSugg && !suggError && suggestions.length > 0 && (
          <>
            <ul className="quiz-suggest-list">
              {suggestions.map((t, i) => {
                const isSel = t.spotifyUrl && selected.has(t.spotifyUrl);
                const isSaved = savedSet.has(t.spotifyUrl || `${t.title}·${t.artist}`);
                return (
                  <li className="quiz-song-card" key={`${t.spotifyUrl || t.title}-${i}`}>
                    <button
                      className="quiz-song-play"
                      onClick={() => playList(suggestions, i)}
                      title="Play (and queue the rest)"
                      aria-label={`Play ${t.title}`}
                    >▶</button>
                    {t.albumArt
                      ? <img className="quiz-song-art" src={t.albumArt} alt="" />
                      : <span className="quiz-song-art quiz-song-art--empty">♪</span>}
                    <span className="quiz-song-info">
                      <span className="quiz-song-title" title={t.title}>{t.title}</span>
                      <span className="quiz-song-artist" title={t.artist}>{t.artist}</span>
                    </span>
                    <button
                      className={`quiz-song-save ${isSaved ? 'is-on' : ''}`}
                      onClick={() => toggleSave(t)}
                      title={isSaved ? 'Saved — tap to remove' : 'Save for later'}
                      aria-label={isSaved ? 'Remove from saved' : 'Save song'}
                    >
                      {isSaved ? '♥' : '♡'}
                    </button>
                    <button
                      className={`quiz-song-pick ${isSel ? 'is-on' : ''}`}
                      onClick={() => toggleSelect(t.spotifyUrl)}
                      disabled={!t.spotifyUrl}
                      title={isSel ? 'Will be added to your next playlist' : 'Add to your next playlist'}
                    >
                      {isSel ? '✓ added' : '+ add'}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="quiz-suggest-hint">
              ▶ plays in-app (queues the rest) · ♥ saves to your Saved tab · ✓ rides into your next playlist
            </p>
          </>
        )}
      </div>

      <div className="quiz-result-actions">
        <button className="quiz-btn-primary" onClick={handleBuild}>
          {selected.size > 0
            ? `Use ${selected.size} song${selected.size > 1 ? 's' : ''} in my next playlist →`
            : 'Use my style in the next playlist →'}
        </button>
        <button className="quiz-btn-ghost" onClick={onRetake}>
          Retake
        </button>
      </div>
    </div>
  );
}

export default QuizPage;
