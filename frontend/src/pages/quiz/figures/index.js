// Modular figure index for Saint or Sinner.
//
// Each topical file (Bollywood, South cinema, Hollywood/TV, music, sports,
// tech/power) exports an array of figures shaped to the same schema as the
// originals in saintOrSinnerData.js.  We concatenate them here so the parent
// data file stays a thin re-export and individual files can grow without
// turning into a 5000-line monolith.
//
// To add another batch: drop a new figures-<topic>.js file in this directory,
// import it here, and append it to EXTENDED_FIGURES.

import { BOLLYWOOD_FIGURES }     from './figures-bollywood.js';
import { SOUTH_CINEMA_FIGURES }  from './figures-south-cinema.js';
import { HOLLYWOOD_TV_FIGURES }  from './figures-hollywood-tv.js';
import { MUSIC_FIGURES }         from './figures-music.js';
import { SPORTS_FIGURES }        from './figures-sports.js';
import { TECH_POWER_FIGURES }    from './figures-tech-power.js';

export const EXTENDED_FIGURES = [
  ...BOLLYWOOD_FIGURES,
  ...SOUTH_CINEMA_FIGURES,
  ...HOLLYWOOD_TV_FIGURES,
  ...MUSIC_FIGURES,
  ...SPORTS_FIGURES,
  ...TECH_POWER_FIGURES,
];
