/**
 * Pictures for pop-ups: one for each kind of event (a volcano, a whale, a storm, a wedding…), each
 * in its own carved gold ring (public/ui/events), shown beside the words. A pop-up names its
 * picture, or one is chosen from its words (`artFor`).
 */

export type ArtKey =
  | 'volcano' | 'island' | 'storm' | 'rain' | 'eclipse' | 'comet' | 'jaguar' | 'shark' | 'croc' | 'monkey'
  | 'whale' | 'dolphin' | 'turtle' | 'dog' | 'raiders' | 'ship' | 'canoe' | 'pearl' | 'fire' | 'fireworks'
  | 'lantern' | 'wedding' | 'baby' | 'sick' | 'death' | 'food' | 'bridge' | 'warrior' | 'sun' | 'chest';


export const ART_KEYS: readonly ArtKey[] = [
  'volcano', 'island', 'storm', 'rain', 'eclipse', 'comet', 'jaguar', 'shark', 'croc', 'monkey', 'whale', 'dolphin', 'turtle', 'dog',
  'raiders', 'ship', 'canoe', 'pearl', 'fire', 'fireworks', 'lantern', 'wedding', 'baby', 'sick', 'death', 'food', 'bridge', 'warrior', 'sun', 'chest',
];

/** Where a picture is served from. */
export const artSrc = (k: ArtKey) => `./ui/events/${k}.png`;

/** Which picture suits a pop-up's words (the first that matches), or null for none. */
const MATCH: [ArtKey, RegExp][] = [
  ['volcano', /volcan|lava|erupt/],
  ['fire', /on fire|burning|blaze|flames/],
  ['eclipse', /eclipse|sun is going dark|eating the sun/],
  ['comet', /comet/],
  ['storm', /storm|thunder|lightning/],
  ['rain', /\brain\b|\braining\b/],
  ['jaguar', /jaguar/],
  ['shark', /shark/],
  ['croc', /alligator|crocodile|caiman/],
  ['monkey', /monkey/],
  ['whale', /whale/],
  ['dolphin', /dolphin/],
  ['turtle', /turtle/],
  ['dog', /\bdogs?\b|puppy|kennel/],
  ['raiders', /raider|rival canoe/],
  ['ship', /voyage|trade boat|traders|\bship\b/],
  ['canoe', /canoe|settler/],
  ['pearl', /pearl|oyster/],
  ['fireworks', /firework|gunpowder/],
  ['lantern', /lantern/],
  ['wedding', /marry|wedding|married/],
  ['baby', /\bborn\b|baby|birth/],
  ['death', /died|passed away|killed|farewell|to rest|funeral|graveyard|mourn/],
  ['sick', /sick|fever|wound|hurt|healing|cure|bitten|mauled/],
  ['food', /food|hungry|starv|harvest|crops?\b/],
  ['bridge', /bridge/],
  ['warrior', /warrior/],
];

export function artFor(text: string): ArtKey | null {
  const t = text.toLowerCase();
  for (const [k, re] of MATCH) if (re.test(t)) return k;
  return null;
}
