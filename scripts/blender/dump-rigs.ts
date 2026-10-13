// Writes the measured islander joints (src/entities/glbPeople.ts RIGS) for the Blender rigging script.
import { writeFileSync } from 'node:fs';
import { BONES, RIGS } from '../../src/entities/glbPeople';

const out = Object.fromEntries(Object.entries(RIGS).map(([k, r]) => [k, { joint: r.joint, top: r.top, tipL: r.tipL, toeL: r.toeL }]));
writeFileSync(process.argv[2], JSON.stringify({ bones: BONES, rigs: out }, null, 1));
