import { ARCHETYPES, AXES, QUESTIONS } from './quizData.js';

const NEUTRAL_ID = 'normal';
const SOFTMAX_TAU = 0.22;
const INTENSITY_SCALE = 2.5;
const MODEL_WEIGHT = 0.55;
const BLEND_RATIO = 0.8;
const CONFIDENCE_FLOOR = 76;
const CONFIDENCE_CEIL = 97;

const QUESTION_BY_ID = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
const weightOf = (q) => (q && Number.isFinite(q.weight) ? q.weight : 1);
const scored = (q) => Array.isArray(q.options) && q.options.some((o) => o.delta);

function computeItemStats() {
  const means = {};
  const stds = {};
  const perQuestion = {};
  for (const axis of AXES) {
    let mean = 0;
    let variance = 0;
    for (const q of QUESTIONS) {
      if (!scored(q)) continue;
      const w = weightOf(q);
      const values = q.options.map((o) => o.delta?.[axis] || 0);
      const m = values.reduce((a, b) => a + b, 0) / values.length;
      const v = values.reduce((a, b) => a + (b - m) * (b - m), 0) / values.length;
      mean += w * m;
      variance += w * w * v;
      perQuestion[q.id] = perQuestion[q.id] || {};
      perQuestion[q.id][axis] = m;
    }
    means[axis] = mean;
    stds[axis] = Math.max(0.5, Math.sqrt(variance));
  }
  return { means, stds, perQuestion };
}

const ITEM_STATS = computeItemStats();
export const AXIS_STDS = ITEM_STATS.stds;
export const AXIS_MEANS = ITEM_STATS.means;

const norm = (v) => Math.sqrt(AXES.reduce((s, a) => s + v[a] * v[a], 0));
const dot = (u, v) => AXES.reduce((s, a) => s + u[a] * v[a], 0);
const cosine = (u, v) => {
  const d = norm(u) * norm(v);
  return d > 0 ? dot(u, v) / d : 0;
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function profileOf(answers) {
  const weighted = Object.fromEntries(AXES.map((a) => [a, 0]));
  for (const a of answers || []) {
    if (!a || !a.delta) continue;
    const w = weightOf(QUESTION_BY_ID[a.questionId]);
    for (const axis of AXES) weighted[axis] += w * (a.delta[axis] || 0);
  }
  return {
    weighted,
    profile: Object.fromEntries(AXES.map((a) => [a, weighted[a] / AXIS_STDS[a]])),
  };
}

export function idealAnswers(archetype) {
  const c = archetype.centroid;
  const length = norm(c);
  return QUESTIONS.filter(scored).map((q) => {
    let best = q.options[0];
    let bestFit = -Infinity;
    for (const o of q.options) {
      const fit = length > 0 ? dot(o.delta, c) / length : -norm(o.delta);
      if (fit > bestFit) { bestFit = fit; best = o; }
    }
    return { questionId: q.id, optionId: best.id, delta: best.delta };
  });
}

const NEUTRAL = ARCHETYPES.find((a) => a.id === NEUTRAL_ID) || null;
const CENTRE = Object.fromEntries(AXES.map((a) => [a, AXIS_MEANS[a] / AXIS_STDS[a]]));
const centred = (v) => Object.fromEntries(AXES.map((a) => [a, v[a] - CENTRE[a]]));
const NEUTRAL_PROFILE = NEUTRAL ? profileOf(idealAnswers(NEUTRAL)).profile : CENTRE;

const PROTOTYPES = ARCHETYPES.filter((a) => a.id !== NEUTRAL_ID).map((archetype) => ({
  archetype,
  direction: centred(profileOf(idealAnswers(archetype)).profile),
}));

function softmax(values, tau) {
  const scaled = values.map((v) => v / tau);
  const max = Math.max(...scaled);
  const exps = scaled.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function consistencyOf(answers, profile) {
  if (norm(profile) === 0) return 0;
  let total = 0;
  let weightSum = 0;
  for (const a of answers) {
    const q = QUESTION_BY_ID[a?.questionId];
    if (!a?.delta || !q) continue;
    const item = Object.fromEntries(
      AXES.map((axis) => [
        axis,
        ((a.delta[axis] || 0) - (ITEM_STATS.perQuestion[q.id]?.[axis] || 0)) / AXIS_STDS[axis],
      ])
    );
    if (norm(item) === 0) continue;
    const w = weightOf(q);
    total += w * cosine(item, profile);
    weightSum += w;
  }
  return weightSum > 0 ? clamp01((total / weightSum + 0.1) / 0.7) : 0;
}

function summarise(entries, extras) {
  const ranking = [...entries].sort((a, b) => b.confidence - a.confidence);
  const winner = ranking[0];
  const runnerUp = ranking[1] || null;
  const margin = winner.confidence - (runnerUp?.confidence ?? 0);
  const ratio = winner.confidence > 0 ? (runnerUp?.confidence ?? 0) / winner.confidence : 1;
  const decisive = clamp01((1 - ratio) / 0.6);
  const certainty = clamp01(
    0.5 * decisive + 0.3 * (extras.consistency ?? 0) + 0.2 * (extras.agreement ?? 0.5)
  );
  const displayConfidence = Math.round(
    CONFIDENCE_FLOOR + certainty * (CONFIDENCE_CEIL - CONFIDENCE_FLOOR)
  );
  const topMatches = ranking
    .slice(0, 3)
    .filter((r, i) => i === 0 || r.confidence >= winner.confidence * BLEND_RATIO)
    .map((r) => ({ archetype: r.archetype, confidence: r.confidence }));
  return {
    ranking,
    archetype: winner.archetype,
    runnerUp: runnerUp?.archetype || null,
    confidence: winner.confidence,
    runnerUpConfidence: runnerUp?.confidence ?? 0,
    margin,
    displayConfidence,
    topMatches,
  };
}

export function score(answers) {
  const { weighted, profile: rawProfile } = profileOf(answers);
  const scores = Object.fromEntries(AXES.map((a) => [a, Math.round(weighted[a])]));

  const profile = centred(rawProfile);
  const fromNeutral = Object.fromEntries(AXES.map((a) => [a, rawProfile[a] - NEUTRAL_PROFILE[a]]));
  const intensity = norm(fromNeutral) / Math.sqrt(AXES.length);
  const pull = Math.tanh(intensity / INTENSITY_SCALE);

  const raw = PROTOTYPES.map(({ archetype, direction }) => ({
    archetype,
    fit: cosine(profile, direction) * pull,
  }));
  if (NEUTRAL) raw.push({ archetype: NEUTRAL, fit: 1 - pull });

  const probs = softmax(raw.map((r) => r.fit), SOFTMAX_TAU);
  const entries = raw.map((r, i) => ({
    archetype: r.archetype,
    distance: 1 - r.fit,
    distanceSq: (1 - r.fit) * (1 - r.fit),
    confidence: probs[i],
  }));

  const consistency = consistencyOf(answers || [], profile);
  return {
    scores,
    profile,
    intensity,
    consistency,
    ...summarise(entries, { consistency }),
  };
}

export function refine(result, llmScores) {
  if (!result || !llmScores || typeof llmScores !== 'object') return result;
  const values = result.ranking.map((r) => Math.max(0, Number(llmScores[r.archetype.id]) || 0));
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return result;

  const reader = values.map((v) => v / total);
  const entries = result.ranking.map((r, i) => ({
    ...r,
    confidence: MODEL_WEIGHT * r.confidence + (1 - MODEL_WEIGHT) * reader[i],
  }));
  const readerTop = result.ranking[reader.indexOf(Math.max(...reader))].archetype.id;
  const agreement =
    readerTop === result.archetype.id ? 1
    : readerTop === result.runnerUp?.id ? 0.6
    : 0.2;

  return {
    ...result,
    ...summarise(entries, { consistency: result.consistency, agreement }),
    readerAgreement: agreement,
  };
}

export function axisToUnit(value, axis) {
  const sigma = (axis && AXIS_STDS[axis]) || 3.2;
  const mean = (axis && AXIS_MEANS[axis]) || 0;
  const z = Math.max(-2.5, Math.min(2.5, (value - mean) / sigma));
  return (z + 2.5) / 5;
}
