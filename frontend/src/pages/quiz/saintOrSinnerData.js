// Saint or Sinner, data deck for the blind reputation-judgment game.
//
// Each figure is a REAL public person (historical or present-day, global mix).
// The player reads a few deliberately cryptic-but-factual traits, slides a
// verdict on the Sinner↔Saint spectrum WITHOUT knowing who it is, then guesses
// the identity from three plausible options. The reveal compares their slider
// to `reputation`, a curated, approximate read on how the world *generally*
// regards the person. It is opinion/entertainment, not a moral fact, and the
// traits are drawn from public record (no invented allegations).
//
// Figure shape:
//   id          stable slug
//   name        the correct answer (also present in `options`)
//   era         'Historical' | 'Modern'   (just a flavour tag on the reveal)
//   traits      3–5 short factual lines, cryptic enough to keep the guess alive
//   options     exactly 3 candidate names incl. `name`; shuffled at render time
//   reputation  0..100 position on the spectrum (0 = reviled, 100 = beloved)
//   verdict     short chip shown on reveal
//   reveal      one line: who they are + why the score sits where it does

export const SPECTRUM = {
  min: 0,
  max: 100,
  low: 'Sinner',
  high: 'Saint',
};

// How many figures one playthrough serves up (deck is shuffled + sliced).
export const ROUND_COUNT = 8;

// Map a 0..100 score to a band, used for the live slider label and the
// reveal chip. Colours lean on the app's cool palette plus warm/red for the
// low end.
export function repBand(score) {
  if (score >= 85) return { key: 'saint',  label: 'Saint',       color: '#9fd8b4' };
  if (score >= 65) return { key: 'good',   label: 'Good Egg',    color: '#9ab8cc' };
  if (score >= 45) return { key: 'mixed',  label: 'Complicated', color: '#c9c2a6' };
  if (score >= 25) return { key: 'shady',  label: 'Shady',       color: '#d99a5a' };
  return                    { key: 'sinner', label: 'Sinner',     color: '#cf6b6b' };
}

export const FIGURES = [
  {
    id: 'mandela',
    name: 'Nelson Mandela',
    era: 'Modern',
    traits: [
      'Trained as a lawyer and co-founded his country’s first Black law firm.',
      'Spent 27 years behind bars as a political prisoner.',
      'Once led the armed wing of a banned resistance movement.',
      'Walked free and, four years later, was elected president.',
      'Chose reconciliation over revenge.',
    ],
    options: ['Desmond Tutu', 'Nelson Mandela', 'Kofi Annan'],
    reputation: 91,
    verdict: 'Beloved',
    reveal: 'Nelson Mandela, from prisoner to president, a near-universal symbol of forgiveness.',
  },
  {
    id: 'gandhi',
    name: 'Mohandas Gandhi',
    era: 'Historical',
    traits: [
      'Trained as a barrister in London.',
      'Spent two decades fighting injustice abroad before returning home.',
      'Led millions in protest without ever raising a fist.',
      'Walked hundreds of miles to make salt a symbol of defiance.',
      'Some of his personal habits and views are still hotly debated.',
    ],
    options: ['Bhagat Singh', 'Jawaharlal Nehru', 'Mohandas Gandhi'],
    reputation: 82,
    verdict: 'Revered, with caveats',
    reveal: 'Mohandas (Mahatma) Gandhi, icon of nonviolent independence, though historians debate the man behind the myth.',
  },
  {
    id: 'curie',
    name: 'Marie Curie',
    era: 'Historical',
    traits: [
      'Studied in secret before women were allowed at her local university.',
      'The first person ever to win two Nobel Prizes, in two different sciences.',
      'Coined a word every physics class now uses.',
      'Her century-old notebooks are still too radioactive to handle safely.',
    ],
    options: ['Rosalind Franklin', 'Marie Curie', 'Ada Lovelace'],
    reputation: 89,
    verdict: 'Admired',
    reveal: 'Marie Curie, pioneer of radioactivity who gave her health to her work; broadly admired to this day.',
  },
  {
    id: 'teresa',
    name: 'Mother Teresa',
    era: 'Historical',
    traits: [
      'Left home at 18 and never saw her mother again.',
      'Founded a religious order that grew to thousands across the globe.',
      'Won a Nobel Peace Prize for serving the poorest of the poor.',
      'Critics questioned the standard of care and the origins of the donations.',
    ],
    options: ['Florence Nightingale', 'Mother Teresa', 'Princess Diana'],
    reputation: 60,
    verdict: 'Complicated',
    reveal: 'Mother Teresa, sainted by the Church and beloved by millions, yet seriously challenged by some who studied her work.',
  },
  {
    id: 'columbus',
    name: 'Christopher Columbus',
    era: 'Historical',
    traits: [
      'Miscalculated the size of the planet, badly.',
      'Took three rejections before a crown finally funded him.',
      'Insisted he had reached Asia until the day he died.',
      'Governed a colony so brutally he was arrested and shipped home in chains.',
    ],
    options: ['Ferdinand Magellan', 'Christopher Columbus', 'Vasco da Gama'],
    reputation: 27,
    verdict: 'Falling fast',
    reveal: 'Christopher Columbus, once a textbook hero, his reputation has collapsed under the weight of what colonisation wrought.',
  },
  {
    id: 'leopold',
    name: 'King Leopold II of Belgium',
    era: 'Historical',
    traits: [
      'A European monarch with a polite, ceremonial role back home.',
      'Privately owned an African territory 76 times the size of his own country.',
      'Ran it for rubber profit with forced labour and severed-hand quotas.',
      'Millions died, and he never once set foot there.',
    ],
    options: ['Cecil Rhodes', 'King Leopold II of Belgium', 'King Philip II of Spain'],
    reputation: 5,
    verdict: 'Reviled (and under-known)',
    reveal: 'King Leopold II, his Congo Free State is among history’s deadliest atrocities, still shockingly absent from many classrooms.',
  },
  {
    id: 'hitler',
    name: 'Adolf Hitler',
    era: 'Historical',
    traits: [
      'Rejected from art school, twice.',
      'A decorated, wounded soldier in the First World War.',
      'Rose to power through elections before dismantling democracy.',
      'A vegetarian who doted on his dog.',
      'Orchestrated an industrialised genocide of millions.',
    ],
    options: ['Benito Mussolini', 'Joseph Stalin', 'Adolf Hitler'],
    reputation: 2,
    verdict: 'Reviled',
    reveal: 'Adolf Hitler, architect of the Holocaust and the world’s near-universal shorthand for evil.',
  },
  {
    id: 'escobar',
    name: 'Pablo Escobar',
    era: 'Modern',
    traits: [
      'Reportedly got his start reselling stolen gravestones.',
      'Became one of the richest criminals who ever lived.',
      'Built houses, schools and football pitches for the poor.',
      'Also ordered thousands of killings, including bombings of civilians.',
    ],
    options: ['Pablo Escobar', 'Joaquín “El Chapo” Guzmán', 'Al Capone'],
    reputation: 15,
    verdict: 'Reviled (with a folk-hero myth)',
    reveal: 'Pablo Escobar, a mass-murdering drug lord still romanticised by some he once bought loyalty from.',
  },
  {
    id: 'keanu',
    name: 'Keanu Reeves',
    era: 'Modern',
    traits: [
      'Quietly gave away large chunks of his blockbuster earnings.',
      'Gets photographed riding the subway and giving up his seat.',
      'Has weathered profound personal loss without bitterness.',
      'The internet collectively decided he is too pure for this world.',
    ],
    options: ['Tom Hanks', 'Keanu Reeves', 'Hugh Jackman'],
    reputation: 92,
    verdict: 'Internet’s sweetheart',
    reveal: 'Keanu Reeves, actor turned folk-saint of online kindness; about as universally liked as a celebrity gets.',
  },
  {
    id: 'musk',
    name: 'Elon Musk',
    era: 'Modern',
    traits: [
      'Left his home country alone as a teenager.',
      'Made his first fortune from an online payments company.',
      'Builds electric cars and lands rockets back on their tails.',
      'Also cannot stop posting, and it keeps landing him in trouble.',
    ],
    options: ['Jeff Bezos', 'Elon Musk', 'Mark Zuckerberg'],
    reputation: 44,
    verdict: 'Deeply polarising',
    reveal: 'Elon Musk, visionary engineer to some, reckless provocateur to others; few opinions land in the middle.',
  },
  {
    id: 'swift',
    name: 'Taylor Swift',
    era: 'Modern',
    traits: [
      'Wrote her way out of country music into total pop domination.',
      'Re-recorded her old albums just to own them outright.',
      'A single tour measurably boosted whole cities’ economies.',
      'Some find the omnipresence, and the private-jet mileage, grating.',
    ],
    options: ['Beyoncé', 'Taylor Swift', 'Adele'],
    reputation: 71,
    verdict: 'Adored (mostly)',
    reveal: 'Taylor Swift, a generation-defining songwriter whose sheer ubiquity is both her power and her critics’ gripe.',
  },
  {
    id: 'ye',
    name: 'Kanye West',
    era: 'Modern',
    traits: [
      'One of the most influential music producers of his generation.',
      'Ran for president, sort of.',
      'Designed sneakers that sold in the billions.',
      'Torched much of his goodwill with antisemitic outbursts.',
    ],
    options: ['Drake', 'Kanye West', 'Travis Scott'],
    reputation: 26,
    verdict: 'Genius to pariah',
    reveal: 'Kanye West (Ye), a once-celebrated artist whose reputation cratered under his own public conduct.',
  },
  {
    id: 'diana',
    name: 'Princess Diana',
    era: 'Modern',
    traits: [
      'Married into the world’s most-watched family at just 20.',
      'Shook hands with AIDS patients when public fear was at its peak.',
      'Walked through a live landmine field to make a point.',
      'Her sudden death triggered a global outpouring of grief.',
    ],
    options: ['Grace Kelly', 'Princess Diana', 'Audrey Hepburn'],
    reputation: 86,
    verdict: 'Beloved',
    reveal: 'Princess Diana, “the people’s princess, ” remembered for warmth and a fearless use of her fame.',
  },
  {
    id: 'greta',
    name: 'Greta Thunberg',
    era: 'Modern',
    traits: [
      'Began alone, skipping school with a handmade cardboard sign.',
      'Sailed across an ocean rather than board a flight.',
      'Scolded a room of world leaders to their faces.',
      'Adored and mocked in roughly equal measure.',
    ],
    options: ['Malala Yousafzai', 'Greta Thunberg', 'Emma Watson'],
    reputation: 54,
    verdict: 'Polarising',
    reveal: 'Greta Thunberg, climate activist hailed as a conscience by some and resented as a scold by others.',
  },
  {
    id: 'messi',
    name: 'Lionel Messi',
    era: 'Modern',
    traits: [
      'As a boy, a club paid for the growth-hormone treatment he needed.',
      'Then spent two decades repaying them on the pitch.',
      'Won a record number of his sport’s top individual award.',
      'Finally lifted the World Cup and quietly settled the debate.',
    ],
    options: ['Cristiano Ronaldo', 'Lionel Messi', 'Neymar'],
    reputation: 84,
    verdict: 'Beloved',
    reveal: 'Lionel Messi, widely regarded as one of the greatest to ever play, and an unusually uncontroversial superstar.',
  },
];
