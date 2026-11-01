import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const QUIZ_DIR = join(HERE, '..', 'frontend', 'src', 'pages', 'quiz');
const DATA_URL = pathToFileURL(join(QUIZ_DIR, 'quizData.js')).href;
const OUT_FILE = join(HERE, 'runs', 'quiz_holdout.json');

const { ARCHETYPES, AXES, QUESTIONS } = await import(DATA_URL);

const SCALES = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 3.0];
const BASELINE_SCALE = 1.0;
const NOISE_LEVELS = [1, 2, 3];
const TUNE_SEED = 1111;
const TUNE_PER_ARCHETYPE = 500;
const HOLDOUT_SEED = 777;
const HOLDOUT_PER_ARCHETYPE = 1000;
const NEUTRAL_ID = 'normal';

const questions = QUESTIONS.filter((q) => Array.isArray(q.options) && q.options.some((o) => o.delta));
const dot = (u, v) => AXES.reduce((s, a) => s + (u[a] || 0) * (v[a] || 0), 0);

function simulate(seed, noise, perArchetype) {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const answer = (centroid, neutral) => questions.map((q) => {
    const fits = q.options.map((o) => {
      const delta = o.delta || {};
      return neutral ? -Math.sqrt(dot(delta, delta)) : dot(delta, centroid);
    });
    const best = Math.max(...fits);
    const weights = fits.map((f) => Math.exp((f - best) / noise));
    let remaining = random() * weights.reduce((a, b) => a + b, 0);
    let pick = 0;
    while (remaining > weights[pick]) {
      remaining -= weights[pick];
      pick += 1;
    }
    const option = q.options[pick];
    return { questionId: q.id, optionId: option.id, delta: option.delta };
  });

  const people = [];
  for (const archetype of ARCHETYPES) {
    const neutral = AXES.every((a) => !archetype.centroid[a]);
    for (let i = 0; i < perArchetype; i += 1) {
      people.push({ truth: archetype.id, answers: answer(archetype.centroid, neutral) });
    }
  }
  return people;
}

function macroF1(rows) {
  const perClass = ARCHETYPES.map(({ id }) => {
    const tp = rows.filter((r) => r.truth === id && r.pred === id).length;
    const fp = rows.filter((r) => r.truth !== id && r.pred === id).length;
    const fn = rows.filter((r) => r.truth === id && r.pred !== id).length;
    return (2 * tp) / Math.max(1, 2 * tp + fp + fn);
  });
  return perClass.reduce((a, b) => a + b, 0) / perClass.length;
}

function summarise(rows) {
  const neutral = rows.filter((r) => r.truth === NEUTRAL_ID);
  return {
    macroF1: +macroF1(rows).toFixed(4),
    accuracy: +(rows.filter((r) => r.truth === r.pred).length / rows.length).toFixed(4),
    neutralRecall: +(neutral.filter((r) => r.pred === NEUTRAL_ID).length / neutral.length).toFixed(4),
  };
}

const workDir = mkdtempSync(join(tmpdir(), 'quiz-calibration-'));
const source = readFileSync(join(QUIZ_DIR, 'scoreQuiz.js'), 'utf8').replace("from './quizData.js'", `from '${DATA_URL}'`);

async function scorerFor(scale) {
  const path = join(workDir, `score_${scale}.mjs`);
  writeFileSync(path, source.replace(/const INTENSITY_SCALE = [0-9.]+;/, `const INTENSITY_SCALE = ${scale};`));
  return (await import(pathToFileURL(path).href)).score;
}

function evaluate(score, people) {
  return people.map((p) => {
    const result = score(p.answers);
    return { truth: p.truth, pred: result.archetype.id, profile: AXES.map((a) => result.profile[a]) };
  });
}

try {
  const tuning = NOISE_LEVELS.map((noise) => simulate(TUNE_SEED, noise, TUNE_PER_ARCHETYPE));
  const grid = [];
  for (const scale of SCALES) {
    const score = await scorerFor(scale);
    const levels = tuning.map((people) => summarise(evaluate(score, people)));
    const meanMacroF1 = levels.reduce((s, l) => s + l.macroF1, 0) / levels.length;
    grid.push({ scale, meanMacroF1: +meanMacroF1.toFixed(4), levels });
    console.log(scale, meanMacroF1.toFixed(4));
  }
  const best = grid.reduce((a, b) => (b.meanMacroF1 > a.meanMacroF1 ? b : a));

  const holdout = NOISE_LEVELS.map((noise) => ({ noise, people: simulate(HOLDOUT_SEED, noise, HOLDOUT_PER_ARCHETYPE) }));
  const runs = {};
  for (const scale of [BASELINE_SCALE, best.scale]) {
    const score = await scorerFor(scale);
    runs[scale] = {};
    for (const { noise, people } of holdout) {
      const rows = evaluate(score, people);
      runs[scale][noise] = { metrics: summarise(rows), rows };
      console.log(`scale ${scale} noise ${noise}`, runs[scale][noise].metrics);
    }
  }

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify({ axes: AXES, bestScale: best.scale, grid, runs }));
  console.log(`best INTENSITY_SCALE ${best.scale}, results in ${OUT_FILE}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
