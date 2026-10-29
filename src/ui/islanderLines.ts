import type { Islander } from '../entities/Islander';

/**
 * What an islander has to say when you look at them: a short line suited to what they are doing,
 * or failing that their job. Each person picks from the pool on their own rhythm (a new line every
 * so often), and never says the same line twice in a row.
 */
const BY_ACTIVITY: [RegExp, string[]][] = [
  [/sleep|resting at home/i, ['Zzz…', '…five more minutes…', 'Mm… the sea is calm tonight…']],
  [/chopping|tree/i, ['This one’s a good straight trunk.', 'Timber for the next house!', 'Mind your toes!', 'The old ones are the hardest to fell.']],
  [/stone|rock/i, ['Good stone, this. It will stand a hundred years.', 'Chip, chip, chip…', 'The masons will be pleased with this block.']],
  [/fruit|picking/i, ['These are ripe at last!', 'One for the basket, one for me.', 'The bushes are heavy this season.']],
  [/carrying|delivering/i, ['Heavy load today!', 'Nearly there…', 'Coming through!', 'The stores are filling up nicely.']],
  [/building/i, ['Another busy day of building.', 'Hold that beam steady!', 'It’s coming along nicely.', 'This one will be finished by nightfall.']],
  [/harvest|field|chinampa|tending/i, ['The crops are looking good today.', 'The soil is rich here.', 'A little rain wouldn’t hurt.', 'Plenty to eat this season.']],
  [/smok/i, ['Smell that? Best fish on the island.', 'Low and slow, that’s the secret.', 'This will keep us through the storms.']],
  [/carv|mason/i, ['Every block has a face waiting inside it.', 'Steady hands, sharp chisel.', 'The temple will need more of these.']],
  [/pray|temple/i, ['May the gods smile on our harvest.', 'Quiet now… I am listening.', 'Thank you for the rain, and the sun.']],
  [/sky|observ/i, ['The stars are bright tonight.', 'A storm gathers to the east, I think.', 'Count the days, read the sky.']],
  [/eat/i, ['Mmm, still warm.', 'Nothing beats a full belly.', 'Pass the chillies!']],
  [/danc|fire|gather/i, ['Sing with us!', 'What a night!', 'Tell the story of the whale again!', 'Dance, dance!']],
  [/shelter|running|flee/i, ['Quickly, inside!', 'Did you hear that?', 'Stay close to the walls!']],
  [/fish|sea|boat/i, ['The sea looks promising.', 'They’re biting this morning!', 'Big one got away… this time.']],
  [/market/i, ['Fine goods for the market today.', 'The canoes should be in soon.', 'Who needs pots? Lovely pots!']],
  [/heal|bed|cared/i, ['I feel a little better already.', 'The healer’s tea is bitter…', 'Thank you for looking after me.']],
  [/patrol|guard|watch/i, ['Keeping the village safe.', 'Nothing gets past me.', 'All quiet on the edge of the jungle.']],
];

const BY_ROLE: Record<string, string[]> = {
  farmer: ['The crops are looking good today.', 'Planting season is my favourite.', 'Good earth, good harvest.'],
  fisher: ['The sea looks promising.', 'Nets mended and ready.', 'You can smell the fish from here, can’t you?'],
  builder: ['Another busy day of building.', 'Where shall we build next?', 'Every house starts with one stone.'],
  woodcutter: ['The forest gives, and we plant again.', 'My axe needs sharpening.', 'Timber!'],
  miner: ['Stone is patient. So am I.', 'The hills are full of good rock.'],
  gatherer: ['The jungle is full of good things.', 'I know where the sweetest fruit grows.'],
  priest: ['The gods are watching over us.', 'The calendar says a good day is coming.'],
  warrior: ['Keeping the village safe.', 'Jaguars beware!', 'Eyes open, spear ready.'],
  merchant: ['Fine goods for the market today.', 'Everything has its price.'],
  mason: ['Steady hands, sharp chisel.', 'The temple will need more stone.'],
  smoker: ['Low and slow, that’s the secret.', 'Smoked fish keeps for months.'],
  butcher: ['Nothing goes to waste.', 'There’ll be meat at the fire tonight.'],
  child: ['Catch me if you can!', 'When I grow up I’ll build a temple!', 'Look, a butterfly!', 'Is it dinner time yet?'],
  idle: ['I wonder what’s happening at the market?', 'Lovely day, isn’t it?', 'Is there anything that needs doing?', 'I could sit and watch the sea all day.'],
};

/** Seconds between new lines for one islander. */
const EVERY = 9;
const said = new Map<number, { beat: number; line: string }>();

export function islanderLine(isl: Islander, activity: string, now: number): string {
  const pool = BY_ACTIVITY.find(([re]) => re.test(activity))?.[1] ?? BY_ROLE[isl.child ? 'child' : isl.warrior ? 'warrior' : isl.role] ?? BY_ROLE.idle;
  // Each islander moves on at their own moment, so a crowd doesn't all change lines together.
  const beat = Math.floor((now + isl.id * 3.7) / EVERY);
  const last = said.get(isl.id);
  if (last?.beat === beat && pool.includes(last.line)) return last.line;
  let line = pool[(beat * 7 + isl.id * 13) % pool.length];
  if (line === last?.line && pool.length > 1) line = pool[(pool.indexOf(line) + 1) % pool.length];
  said.set(isl.id, { beat, line });
  return line;
}
