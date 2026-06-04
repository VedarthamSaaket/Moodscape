// Quiz data, 8 archetypes, 8 questions, 4 signed axes.
// Axes: temp (cool−↔warm+), edge (soft−↔sharp+), era (vintage−↔futurist+), density (restrained−↔maximalist+)
// Centroids and seeds are tunable here; UI reads everything from this file.

export const AXES = ['temp', 'edge', 'era', 'density'];

export const AXIS_LABELS = {
  temp:    { neg: 'Cool',       pos: 'Warm' },
  edge:    { neg: 'Soft',       pos: 'Sharp' },
  era:     { neg: 'Vintage',    pos: 'Futurist' },
  density: { neg: 'Restrained', pos: 'Maximalist' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Archetypes, fixed centroids in 4-axis space.
// Result page maps the user's score vector to the nearest centroid (sq Euclidean).
// ─────────────────────────────────────────────────────────────────────────────
export const ARCHETYPES = [
  {
    id: 'cottagecore',
    name: 'Cottagecore',
    centroid: { temp: +1, edge: -1, era: -2, density: +2 },
    accent: { from: '#a9b88a', to: '#f0e6d2' },
    blurb: 'Hand-pulled bread, sun through linen, a slow Sunday that never ends.',
    vibePrompt:
      'Soft sunlit afternoons, hand-pulled bread on a wooden table, distant church bells, a slow folk record on the porch.',
    genreSeed:    ['Folk', 'Indie'],
    languageSeed: ['English', 'Hindi'],
  },
  {
    id: 'dark-academia',
    name: 'Dark Academia',
    centroid: { temp: -1, edge: 0, era: -2, density: 0 },
    accent: { from: '#5b2230', to: '#dce8f0' },
    blurb: 'Candlelit libraries, ink-stained cuffs, Latin underlined twice in the margins.',
    vibePrompt:
      'Rain on cathedral windows, candlewax on old paper, the loneliness of a half-finished translation at 2am.',
    genreSeed:    ['Classical', 'Indie'],
    languageSeed: ['English'],
  },
  {
    id: 'y2k-chrome',
    name: 'Y2K Chrome',
    centroid: { temp: -1, edge: +2, era: +2, density: +1 },
    accent: { from: '#c0c8d0', to: '#5fd7ff' },
    blurb: 'Glossy plastic, pixel hearts, the 2003 future that never quite arrived.',
    vibePrompt:
      'Flip-phone glow, holographic stickers on a CRT, synthetic strings over a four-on-the-floor pulse, the early-2000s future dialed up.',
    genreSeed:    ['Electronic / EDM', 'Pop'],
    languageSeed: ['English', 'Korean'],
  },
  {
    id: 'cinematic-dusk',
    name: 'Cinematic Dusk',
    centroid: { temp: -1, edge: -1, era: -1, density: -2 },
    accent: { from: '#5b6f8f', to: '#8e9fc4' },
    blurb: 'Cold mountain light, slow film grain, the hour before night.',
    vibePrompt:
      'Cold mountain light, slow film grain, the long pause before night, a soundtrack for solitary drives and quiet windows.',
    genreSeed:    ['Ambient', 'Indie'],
    languageSeed: ['English', 'Hindi'],
  },
  {
    id: 'coquette',
    name: 'Coquette / Balletcore',
    centroid: { temp: +1, edge: -2, era: -1, density: 0 },
    accent: { from: '#e8b6c2', to: '#f6e6d8' },
    blurb: 'Silk ribbons, pointe shoes on parquet, perfume that lingers a room behind you.',
    vibePrompt:
      'Pink ribbons on pointe shoes, a music box opened slowly, soft strings and a voice that whispers in French.',
    genreSeed:    ['Indie', 'Classical'],
    languageSeed: ['English', 'French'],
  },
  {
    id: 'maximalist-eclectic',
    name: 'Maximalist Eclectic',
    centroid: { temp: +1, edge: +1, era: 0, density: +2 },
    accent: { from: '#d97a3a', to: '#b8298a' },
    blurb: 'Every wall a story, every shelf a souvenir, more is the answer to most questions.',
    vibePrompt:
      'A flea-market apartment thick with rugs and records, global percussion, brass, languages weaving over each other in the kitchen.',
    genreSeed:    ['Pop', 'Hip-Hop / Rap', 'Indie'],
    languageSeed: ['Hindi', 'Spanish', 'English'],
  },
  {
    id: 'post-romance',
    name: 'Post Romance',
    centroid: { temp: +1, edge: +1, era: +2, density: 0 },
    accent: { from: '#b88a98', to: '#4a2840' },
    blurb: 'Soft modernism, after-the-breakup gloss, slow synths and a quieter heart.',
    vibePrompt:
      'A dim room at 1am, post-breakup. Reverb-drenched guitars, breathy vocals, the romance of getting through tonight.',
    genreSeed:    ['Indie', 'Pop'],
    languageSeed: ['English', 'French'],
  },
  {
    id: 'brutalist',
    name: 'Brutalist / Industrial',
    centroid: { temp: -2, edge: +2, era: +2, density: -2 },
    accent: { from: '#5a5a5e', to: '#d96024' },
    blurb: 'Raw concrete, exposed bolts, a single red light in a long grey corridor.',
    vibePrompt:
      'Concrete-floor warehouses, single-bulb shadow, a kick drum that feels like a closing door, minimal, mechanical, alive.',
    genreSeed:    ['Electronic / EDM', 'Rock'],
    languageSeed: ['English'],
  },
];


// ─────────────────────────────────────────────────────────────────────────────
// Questions, 8 total. 6 image-tile (4 options) + 2 likert (5 options).
// Every question probes ≥2 axes. Each axis is touched ≥3 times across the set.
// Prompts are written second-person and personal: what do YOU reach for, what
// sits closest to how you actually feel.
// ─────────────────────────────────────────────────────────────────────────────
export const QUESTIONS = [
  {
    id: 'sky',
    kind: 'tile',
    prompt: 'Which sky feels most like yours?',
    caption: 'The one you would step into right now, no questions asked.',
    options: [
      {
        id: 'dawn-mist',
        label: 'Dawn Mist',
        whisper: 'Hayfields, hush, smoke from a chimney.',
        swatch: 'linear-gradient(160deg,#dfd2b6 0%,#c9c2a6 45%,#8ea3a0 100%)',
        searchQuery: 'foggy meadow sunrise pastoral',
        delta: { temp: +1, edge: -1, era: -1, density: 0 },
      },
      {
        id: 'cold-dusk',
        label: 'Cold Dusk',
        whisper: 'Steel light just before the stars.',
        swatch: 'linear-gradient(160deg,#1c2a3a 0%,#3d4f6b 55%,#8e9fc4 100%)',
        searchQuery: 'cold blue mountain dusk twilight',
        delta: { temp: -2, edge: 0, era: 0, density: -1 },
      },
      {
        id: 'chrome-noon',
        label: 'Chrome Noon',
        whisper: 'Sun off a glass tower at 12:01.',
        swatch: 'linear-gradient(160deg,#9ad6e6 0%,#cfe9ee 45%,#e8f0f4 100%)',
        searchQuery: 'glass skyscraper reflection sky chrome',
        delta: { temp: -1, edge: +2, era: +2, density: 0 },
      },
      {
        id: 'bruise-night',
        label: 'Bruise Night',
        whisper: 'Pink street lamps under a violet ceiling.',
        swatch: 'linear-gradient(160deg,#2a1230 0%,#5a2244 55%,#b8567d 100%)',
        searchQuery: 'pink neon street night purple',
        delta: { temp: 0, edge: 0, era: +1, density: +1 },
      },
    ],
  },

  {
    id: 'room',
    kind: 'tile',
    prompt: 'Where would you rather spend an hour?',
    caption: 'No phone, no plans, just you in the room.',
    options: [
      {
        id: 'library',
        label: 'A library at midnight',
        whisper: 'Green lamps, ink, a single open volume.',
        swatch: 'linear-gradient(160deg,#1a0e0e 0%,#3a1f1e 55%,#6a4a36 100%)',
        searchQuery: 'old library candle lamp dark wood',
        delta: { temp: -1, edge: 0, era: -2, density: 0 },
      },
      {
        id: 'sun-kitchen',
        label: 'A sun-warm kitchen',
        whisper: 'Bread on the counter, basil on the sill.',
        swatch: 'linear-gradient(160deg,#f3e7c8 0%,#d8c08e 50%,#8a9560 100%)',
        searchQuery: 'rustic kitchen sunlight bread linen',
        delta: { temp: +2, edge: -2, era: -1, density: +1 },
      },
      {
        id: 'studio-loft',
        label: 'A bare concrete loft',
        whisper: 'One chair, one red light, one record.',
        swatch: 'linear-gradient(160deg,#2a2a2c 0%,#4a4a4c 55%,#bababd 100%)',
        searchQuery: 'concrete loft minimal industrial interior',
        delta: { temp: -1, edge: +2, era: 0, density: -2 },
      },
      {
        id: 'maximal-parlor',
        label: 'A flea-market parlor',
        whisper: 'Rugs on rugs, brass everywhere, a parrot.',
        swatch: 'linear-gradient(160deg,#8a2a2e 0%,#c14a32 50%,#d4a256 100%)',
        searchQuery: 'maximalist eclectic vintage living room rugs',
        delta: { temp: +1, edge: 0, era: 0, density: +2 },
      },
    ],
  },

  {
    id: 'fabric',
    kind: 'tile',
    prompt: 'Which fabric do you reach for first?',
    caption: 'Skin contact decides this one.',
    options: [
      {
        id: 'lace',
        label: 'Cream lace',
        whisper: 'A trim along the collarbone.',
        swatch: 'linear-gradient(160deg,#f4e8dc 0%,#e8d6c0 50%,#d4a8b0 100%)',
        searchQuery: 'cream lace fabric closeup soft',
        delta: { temp: +1, edge: -2, era: -1, density: 0 },
      },
      {
        id: 'tweed',
        label: 'Heavy tweed',
        whisper: 'Cigar smoke woven into the fibers.',
        swatch: 'linear-gradient(160deg,#3a2a1c 0%,#5b4632 55%,#9a8868 100%)',
        searchQuery: 'tweed fabric texture brown wool',
        delta: { temp: 0, edge: 0, era: -2, density: 0 },
      },
      {
        id: 'pvc',
        label: 'Glossy PVC',
        whisper: 'Catches the light like a chrome bumper.',
        swatch: 'linear-gradient(160deg,#0e0e10 0%,#2a2c34 50%,#7ad0e8 100%)',
        searchQuery: 'glossy black vinyl pvc texture',
        delta: { temp: -1, edge: +2, era: +2, density: 0 },
      },
      {
        id: 'silk-velvet',
        label: 'Silk over velvet',
        whisper: 'Two textures arguing on one shoulder.',
        swatch: 'linear-gradient(160deg,#3a1f3e 0%,#7a2b54 55%,#c46c3a 100%)',
        searchQuery: 'silk velvet fabric jewel tone',
        delta: { temp: +1, edge: 0, era: 0, density: +2 },
      },
    ],
  },

  {
    id: 'sound',
    kind: 'tile',
    prompt: 'What sound do you most want around you?',
    caption: 'Picture the room you would build for it.',
    options: [
      {
        id: 'string-quartet',
        label: 'A string quartet, distant',
        whisper: 'Strings bend a corner before they reach you.',
        swatch: 'linear-gradient(160deg,#0a0a0e 0%,#2a1a2e 55%,#5a4458 100%)',
        searchQuery: 'string quartet violin candlelight',
        delta: { temp: 0, edge: -1, era: -2, density: 0 },
      },
      {
        id: 'analog-synth',
        label: 'A warm analog synth',
        whisper: 'A bass pulse you feel in the wall.',
        swatch: 'linear-gradient(160deg,#2a0a2e 0%,#5a1078 50%,#e8508c 100%)',
        searchQuery: 'analog synthesizer modular pink neon',
        delta: { temp: 0, edge: +1, era: +1, density: +1 },
      },
      {
        id: 'industrial-kick',
        label: 'A steady industrial kick',
        whisper: 'Hollow steel, four to the floor.',
        swatch: 'linear-gradient(160deg,#0a0a0c 0%,#2a2a2c 55%,#d96024 100%)',
        searchQuery: 'industrial warehouse rave smoke red light',
        delta: { temp: -1, edge: +2, era: 0, density: -2 },
      },
      {
        id: 'folk-guitar',
        label: 'An acoustic guitar, sun on the porch',
        whisper: 'Wood, breath, a kettle behind.',
        swatch: 'linear-gradient(160deg,#d6c08c 0%,#a98e58 50%,#5e6a3a 100%)',
        searchQuery: 'acoustic guitar porch sunset folk',
        delta: { temp: +2, edge: -2, era: -1, density: 0 },
      },
    ],
  },

  {
    id: 'dinner',
    kind: 'tile',
    prompt: 'How do you want to eat tonight?',
    caption: 'Be honest, whatever your body is asking for.',
    options: [
      {
        id: 'farm-table',
        label: 'A long wooden table, bread and stew',
        whisper: 'Candles, six friends, no phones.',
        swatch: 'linear-gradient(160deg,#e0c890 0%,#a98a3a 55%,#5a3a1c 100%)',
        searchQuery: 'rustic dinner table candles bread shared',
        delta: { temp: +2, edge: -1, era: -1, density: +1 },
      },
      {
        id: 'neon-counter',
        label: 'A neon ramen counter, alone',
        whisper: 'Steam, pop song, perfect bowl.',
        swatch: 'linear-gradient(160deg,#0a0a0e 0%,#2a0e3a 50%,#e8508c 100%)',
        searchQuery: 'tokyo ramen counter neon night',
        delta: { temp: -1, edge: +2, era: +2, density: 0 },
      },
      {
        id: 'wine-bar',
        label: 'A dim wine bar at the corner',
        whisper: 'Olives, one record on loop, low laughter.',
        swatch: 'linear-gradient(160deg,#1a0e1a 0%,#3a1f30 55%,#a85060 100%)',
        searchQuery: 'dim wine bar candles intimate',
        delta: { temp: 0, edge: -1, era: +1, density: 0 },
      },
      {
        id: 'tasting-menu',
        label: 'A 14-course tasting menu',
        whisper: 'Tweezers, white plate, three hours.',
        swatch: 'linear-gradient(160deg,#1a1c20 0%,#3a3c40 55%,#bababd 100%)',
        searchQuery: 'fine dining minimal plating white plate',
        delta: { temp: -1, edge: +1, era: 0, density: -2 },
      },
    ],
  },

  {
    id: 'tattoo',
    kind: 'tile',
    prompt: 'If you had to tattoo one font on yourself, which?',
    caption: 'No second chance, no second guessing.',
    options: [
      {
        id: 'blackletter',
        label: 'Heavy blackletter',
        whisper: 'A monk’s hand from 1480.',
        swatch: 'linear-gradient(160deg,#0a0a0a 0%,#1a1a1a 60%,#3a2828 100%)',
        searchQuery: 'gothic blackletter calligraphy manuscript',
        delta: { temp: 0, edge: +1, era: -2, density: 0 },
      },
      {
        id: 'pixel-mono',
        label: 'Pixel monospace',
        whisper: 'Eight bits, no apology.',
        swatch: 'linear-gradient(160deg,#0a141c 0%,#1c2a3a 55%,#7ad0e8 100%)',
        searchQuery: 'pixel font crt screen cyan',
        delta: { temp: -1, edge: +2, era: +2, density: 0 },
      },
      {
        id: 'italic-script',
        label: 'A loose italic script',
        whisper: 'A love letter, opened in lamplight.',
        swatch: 'linear-gradient(160deg,#2a1428 0%,#5a2a4a 50%,#d8a6b8 100%)',
        searchQuery: 'handwritten love letter ink calligraphy soft',
        delta: { temp: +1, edge: -2, era: -1, density: 0 },
      },
      {
        id: 'sans-stencil',
        label: 'A bold stenciled sans',
        whisper: 'Spray-paint thick, no serif at all.',
        swatch: 'linear-gradient(160deg,#1a1a1c 0%,#3a3a3c 55%,#d96024 100%)',
        searchQuery: 'stencil graffiti spray paint bold',
        delta: { temp: -1, edge: +2, era: 0, density: -1 },
      },
    ],
  },

  // ─── Likert tiebreakers ────────────────────────────────────────────────────
  {
    id: 'loudness',
    kind: 'likert',
    prompt: 'How loud do you want your everyday life to be?',
    caption: 'Volume of life, not music. Pick what actually fits you.',
    options: [
      { id: 'silence',  label: 'Library quiet',           delta: { temp: 0,  edge: -1, era: -1, density: -2 } },
      { id: 'low',      label: 'A hum, almost still',     delta: { temp: 0,  edge: -1, era: 0,  density: -1 } },
      { id: 'mid',      label: 'Comfortable room tone',   delta: { temp: 0,  edge: 0,  era: 0,  density: 0 } },
      { id: 'high',     label: 'A room full of friends',  delta: { temp: +1, edge: +1, era: 0,  density: +1 } },
      { id: 'loud',     label: 'Festival, all at once',   delta: { temp: +1, edge: +2, era: 0,  density: +2 } },
    ],
  },

  {
    id: 'beauty',
    kind: 'likert',
    prompt: 'When something feels beautiful to you, it tends to feel...',
    caption: 'Nobody is scoring this but you.',
    options: [
      { id: 'broken',     label: 'Broken in, lived-in',      delta: { temp: +1, edge: -2, era: -2, density: 0 } },
      { id: 'soft',       label: 'Soft and a little faded',  delta: { temp: +1, edge: -1, era: -1, density: 0 } },
      { id: 'composed',   label: 'Carefully composed',       delta: { temp: 0,  edge: 0,  era: 0,  density: 0 } },
      { id: 'sharp',      label: 'Sharp and intentional',    delta: { temp: -1, edge: +2, era: +1, density: -1 } },
      { id: 'polished',   label: 'Polished to a mirror',     delta: { temp: -1, edge: +2, era: +2, density: -1 } },
    ],
  },
];

// Total count helpers consumed by QuizPage.
export const QUESTION_COUNT = QUESTIONS.length;
