import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useQuizStore from '../store/quizStore.js';
import { QUESTIONS, ARCHETYPES } from './quiz/quizData.js';
import { score } from './quiz/scoreQuiz.js';
import VibeMeter from './quiz/VibeMeter.jsx';
import useQuizImages from './quiz/useQuizImages.js';
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
    completedAt,
    recordAnswer,
    finalize,
    reset,
    setPendingStyleSeed,
  } = useQuizStore();

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

  // Transition helper — short cross-fade matching the rest of the app.
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
        scores:    result.scores,
        archetype: result.archetype,
        runnerUp:  result.runnerUp,
      });
      advance(() => setPhase('result'));
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
    setPendingStyleSeed({
      archetype:  archetype.id,
      name:       archetype.name,
      vibePrompt: archetype.vibePrompt,
      genres:     archetype.genreSeed,
    });
    navigate('/generator');
  };

  // Sync phase if user navigates back here mid-result.
  useEffect(() => {
    if (phase === 'intro' && completedAt) setPhase('result');
  }, [completedAt, phase]);

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

        {phase === 'result' && archetype && (
          <ResultView
            archetype={archetype}
            runnerUp={runnerUp}
            scores={scores}
            onRetake={handleRetake}
            onUseStyle={handleUseStyle}
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

function ResultView({ archetype, runnerUp, scores, onRetake, onUseStyle }) {
  const accent = archetype.accent;
  const gradient = `linear-gradient(110deg, ${accent.from} 0%, ${accent.to} 100%)`;
  const textGradient = {
    backgroundImage: gradient,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
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

      <div className="quiz-result-actions">
        <button className="quiz-btn-primary" onClick={onUseStyle}>
          Use my style in the next playlist
        </button>
        <button className="quiz-btn-ghost" onClick={onRetake}>
          Retake
        </button>
      </div>
    </div>
  );
}

export default QuizPage;
