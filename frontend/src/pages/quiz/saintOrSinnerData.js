// Saint or Sinner, data deck for the blind reputation-judgment game.
//
// Each figure is a REAL public person (historical or present-day, global +
// India-heavy mix). The player reads several DELIBERATELY OBSCURE-but-factual
// traits, the least-famous true things about them, and slides a verdict on the
// Sinner↔Saint spectrum WITHOUT knowing who it is, then guesses the identity
// from three plausible same-field options. The reveal compares their slider to
// `reputation`, a curated, approximate read on how the world *generally* regards
// the person. It is opinion/entertainment, not a moral fact, and every trait is
// drawn from public record (no invented allegations).
//
// Design rules for traits:
//   1. Subtlety first, reach for the side-door details, not the headline fact
//      everyone already knows. The three options give away the *field*, so the
//      traits should make it hard to pick which of the three it is.
//   2. Balance, every figure shows both LITTLE-KNOWN VIRTUES and LITTLE-KNOWN
//      FLAWS, interleaved. Saints get their underrated dark side; sinners get
//      their underrated redeeming side. That tension is the whole game.
//
// Figure shape:
//   id          stable slug
//   name        the correct answer (also present in `options`)
//   era         'Historical' | 'Modern'   (just a flavour tag on the reveal)
//   traits      4–6 short factual lines, understated, good + bad mixed
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
      'As a young man he trained as an amateur heavyweight boxer.',
      'He co-founded and led an armed wing that set off sabotage bombings.',
      'He taught himself his jailers’ language to better understand them.',
      'A schoolteacher handed him the English first name the world now uses.',
      'He stayed loyal to strongmen others shunned, and admitted being a distant father.',
      'He gave away a third of his presidential salary to a children’s fund.',
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
      'Crippled by nerves, he fled his very first courtroom unable to speak.',
      'He ran a communal farm he named after a Russian novelist he admired.',
      'Early in life he wrote of local Black Africans in openly racist terms.',
      'He nursed plague and war victims by hand as a young volunteer.',
      'His eldest son grew so estranged he changed faiths to spite him.',
      'In old age he tested his vow of celibacy by sleeping beside young women.',
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
      'During a world war she drove mobile X-ray vans to the front line.',
      'She refused to patent her discovery, giving it to the world for free.',
      'A love affair with a married colleague became a vicious public scandal.',
      'She handled deadly materials so casually it likely shortened lives, including her own.',
      'Her national academy of sciences still refused her a seat.',
      'A century on, her notebooks are kept in lead-lined boxes.',
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
      'Before her calling she taught geography at a convent school.',
      'Private letters revealed decades of doubt about her own faith.',
      'Her homes were faulted for thin medical care and reused needles.',
      'She lived austerely while her order spread across the globe.',
      'She took, and kept, donations from dictators and convicted fraudsters.',
      'She quietly baptised the dying without their knowledge.',
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
      'A self-taught navigator, he was turned down repeatedly before a crown funded him.',
      'He kept a second, doctored logbook to mislead his own crew.',
      'As a colonial governor he was so brutal he was arrested and shipped home in chains.',
      'He shipped enslaved islanders back across the ocean by the hundreds.',
      'He died insisting he had reached the far edge of Asia.',
      'Where his bones rest is still disputed between two countries.',
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
      'A tall, bearded monarch with a mostly ceremonial role at home.',
      'He sold himself to the world as a humanitarian opening Africa to civilisation.',
      'The wealth he extracted built grand boulevards and monuments in his capital.',
      'That wealth came from forced labour, enforced with severed-hand quotas.',
      'Millions died on the land, and he never once set foot there.',
      'He looted his private empire so badly his own government had to seize it.',
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
      'He was rejected from art school, twice.',
      'A decorated dispatch runner, gassed and wounded in the First World War.',
      'A teetotal vegetarian who shunned smoking and doted on his dog.',
      'He was a hypochondriac, leaning on a quack doctor’s daily injections.',
      'He climbed to power through the ballot box, then dismantled the republic.',
      'He dictated a rambling manifesto in prison that later sold in the millions.',
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
      'He once held elected office as a congressional alternate.',
      'He built housing, schools and football pitches for the poor.',
      'He reportedly spent a fortune each month just on rubber bands for his cash.',
      'He offered officials “silver or lead”, a bribe or a bullet.',
      'He ordered bombings and killings that ran into the thousands.',
      'Hippos from his private zoo still roam the countryside today.',
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
      'His Hawaiian first name means “cool breeze over the mountains.”',
      'He has handed back chunks of his fee so crew and co-stars earned more.',
      'He co-owns a motorcycle workshop and a press that prints art books.',
      'Critics have long needled him as a stiff, one-note actor.',
      'He has fronted his share of expensive box-office flops.',
      'Dyslexia made school hard, and he never finished it.',
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
      'At twelve he coded a little space game and sold it to a magazine.',
      'As a teenager he tested living on a dollar a day of food.',
      'He joined his best-known car company as an investor, not its founder.',
      'A flippant market post cost him a regulator’s fine and a chairmanship.',
      'Former staff describe brutal hours and abrupt mass firings.',
      'He holds citizenship in three different countries.',
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
      'Her cats are named after characters from crime and medical TV dramas.',
      'She handed her touring crew tens of millions in surprise bonuses.',
      'She re-recorded her old albums just to own them outright.',
      'Her private-jet mileage has ranked her among the worst celebrity polluters.',
      'She threatened to sue a student who tracked that jet in public.',
      'She learned guitar from the technician who fixed the family computer.',
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
      'He recorded a breakout track with his jaw wired shut after a car crash.',
      'His late mother chaired a university English department.',
      'He has spoken openly about living with bipolar disorder.',
      'He once called centuries of slavery “a choice.”',
      'He torched much of his goodwill with a run of antisemitic outbursts.',
      'He legally changed his name to a single syllable.',
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
      'Before her famous wedding she worked as an assistant at a kindergarten.',
      'She made secret late-night visits to the homeless and the dying.',
      'She secretly rehearsed a dance and performed it on a London stage as a gift.',
      'She admitted on television to an affair of her own.',
      'She was a shrewd manipulator of the very press she resented.',
      'She is buried on a small island in the middle of a lake.',
    ],
    options: ['Grace Kelly', 'Princess Diana', 'Audrey Hepburn'],
    reputation: 86,
    verdict: 'Beloved',
    reveal: 'Princess Diana, “the people’s princess,” remembered for warmth and a fearless use of her fame.',
  },
  {
    id: 'greta',
    name: 'Greta Thunberg',
    era: 'Modern',
    traits: [
      'She comes from a family of stage actors and an opera singer.',
      'As a child she went through a spell of barely speaking or eating.',
      'She gave away a large cash prize to environmental causes.',
      'Critics dismiss her as an alarmist scold beyond her depth.',
      'She has been detained more than once at protests.',
      'She talked her own family into giving up flying and meat.',
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
      'His family uprooted to Europe when he was just thirteen.',
      'Famously left-footed, he is very rarely booked for a foul.',
      'He funds children’s hospital wards and youth football quietly.',
      'A court once handed him a suspended sentence for tax fraud.',
      'Critics long accused him of going missing in his country’s biggest games.',
      'He hails from the same Argentine city as Che Guevara.',
    ],
    options: ['Cristiano Ronaldo', 'Lionel Messi', 'Neymar'],
    reputation: 84,
    verdict: 'Beloved',
    reveal: 'Lionel Messi, widely regarded as one of the greatest to ever play, and an unusually uncontroversial superstar.',
  },

  // ── India-heavy additions ───────────────────────────────────────────────────
  {
    id: 'kalam',
    name: 'A. P. J. Abdul Kalam',
    era: 'Modern',
    traits: [
      'As a boy he sold newspapers before dawn to help his family.',
      'He missed becoming a fighter pilot by a single place on the list.',
      'A lifelong bachelor, he gave most of his earnings away and played the veena.',
      'He was the proud public face of his country’s nuclear-weapon tests.',
      'As head of state he left a stack of death-row mercy pleas undecided.',
      'He collapsed doing what he loved most, lecturing to students.',
    ],
    options: ['A. P. J. Abdul Kalam', 'Vikram Sarabhai', 'Homi Bhabha'],
    reputation: 90,
    verdict: 'Beloved',
    reveal: 'A. P. J. Abdul Kalam, the rocket scientist who became India’s beloved “People’s President.”',
  },
  {
    id: 'ambedkar',
    name: 'B. R. Ambedkar',
    era: 'Historical',
    traits: [
      'He earned doctorates from universities on two different continents.',
      'He helped win the eight-hour working day for his country’s labourers.',
      'He publicly burned an ancient law-book he called a charter of oppression.',
      'His personal library ran to tens of thousands of books.',
      'He resigned from the cabinet when a women’s-rights bill stalled.',
      'Late in life he led hundreds of thousands away from the faith he was born into.',
    ],
    options: ['B. R. Ambedkar', 'Jawaharlal Nehru', 'Sardar Patel'],
    reputation: 85,
    verdict: 'Revered',
    reveal: 'B. R. Ambedkar, jurist, economist and reformer who shaped the founding document of modern India.',
  },
  {
    id: 'lata',
    name: 'Lata Mangeshkar',
    era: 'Modern',
    traits: [
      'Her father died when she was thirteen, and she acted in films to feed her siblings.',
      'She built a hospital in her late father’s name.',
      'Rivals accused her of using her clout to freeze out newer voices.',
      'An obsessive cricket fan, she held honorary memberships at famous grounds.',
      'A long rift with her own singer-sister played out for years.',
      'Her voice carried across film for some seven decades.',
    ],
    options: ['Lata Mangeshkar', 'Asha Bhosle', 'Noor Jehan'],
    reputation: 87,
    verdict: 'Beloved',
    reveal: 'Lata Mangeshkar, the “Nightingale of India,” whose playback voice defined Hindi cinema for generations.',
  },
  {
    id: 'sachin',
    name: 'Sachin Tendulkar',
    era: 'Modern',
    traits: [
      'As a boy, his coach would place a coin on the stumps for him to win.',
      'He idolised a hot-tempered tennis champion and grew his curls to match.',
      'He quietly adopted villages and funded children’s causes.',
      'Nominated to parliament, he was faulted for barely showing up or speaking.',
      'A waived import tax on his luxury car raised eyebrows.',
      'Some grumbled he chased personal milestones over the team.',
    ],
    options: ['Sachin Tendulkar', 'Rahul Dravid', 'Sourav Ganguly'],
    reputation: 88,
    verdict: 'Beloved',
    reveal: 'Sachin Tendulkar, the “Little Master,” worshipped across a cricket-mad nation.',
  },
  {
    id: 'indira',
    name: 'Indira Gandhi',
    era: 'Modern',
    traits: [
      'The only child of a founding prime minister, she grew up inside the freedom struggle.',
      'As a girl she organised a children’s volunteer brigade.',
      'She led her nation to a decisive war that birthed a new country.',
      'She once suspended civil liberties and jailed her rivals for nearly two years.',
      'A mass-sterilisation drive on her watch scarred the poor.',
      'She sent troops into a faith’s holiest shrine, with bloody consequences.',
    ],
    options: ['Indira Gandhi', 'Sonia Gandhi', 'Benazir Bhutto'],
    reputation: 46,
    verdict: 'Complicated',
    reveal: 'Indira Gandhi, India’s only woman prime minister, admired for her steel and condemned for the Emergency.',
  },
  {
    id: 'rajinikanth',
    name: 'Rajinikanth',
    era: 'Modern',
    traits: [
      'He punched tickets as a bus conductor before his first film role.',
      'Off screen he refuses cosmetic touch-ups and greys in plain sight.',
      'He often vanishes to the Himalayas between projects.',
      'He teased a leap into politics for years, then backed out.',
      'His mass-hero roles have drawn flak for glorifying the strongman.',
      'A film-school teacher spotted him and first cast him as a villain.',
    ],
    options: ['Rajinikanth', 'Kamal Haasan', 'Chiranjeevi'],
    reputation: 84,
    verdict: 'Adored',
    reveal: 'Rajinikanth, the bus conductor turned “Superstar” whose fans treat his releases as festivals.',
  },
  {
    id: 'bose',
    name: 'Subhas Chandra Bose',
    era: 'Historical',
    traits: [
      'He cracked the empire’s elite civil-service exam, then resigned to fight it.',
      'He raised a liberation army abroad, complete with a women’s regiment.',
      'A spellbinding orator, he split bitterly from the movement’s moderate wing.',
      'He sought wartime backing from his rulers’ enemies, and met their dictators.',
      'He once mused his country might need a dictator for twenty years.',
      'Many still refuse to believe he died in that plane crash.',
    ],
    options: ['Subhas Chandra Bose', 'Bhagat Singh', 'Chandra Shekhar Azad'],
    reputation: 73,
    verdict: 'Revered, debated',
    reveal: 'Subhas Chandra Bose, the firebrand “Netaji” whose wartime alliances and unexplained disappearance still spark debate.',
  },
];
