// Shrink a skinned, animated GLB for the game: thin its animation keyframes to `fps` (keeping
// each clip's first and last key) and repack every accessor into its own tight buffer view.
// Usage: node scripts/shrink-glb-anim.mjs in.glb out.glb [fps=30]
import fs from 'node:fs';

const [, , src, dst, fpsArg] = process.argv;
const fps = Number(fpsArg ?? 30);
const glb = fs.readFileSync(src);
const jsonLen = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString());
const binStart = 20 + jsonLen + 8;
const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLen));

const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** An accessor's elements as tightly packed bytes (stride removed). */
function read(a) {
  const v = json.bufferViews[a.bufferView], el = SIZE[a.type] * BYTES[a.componentType];
  const stride = v.byteStride || el, start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = Buffer.alloc(a.count * el);
  for (let i = 0; i < a.count; i++) bin.copy(out, i * el, start + i * stride, start + i * stride + el);
  return out;
}

/** Keep only the elements at `keep` (indices). */
function pick(buf, el, keep) {
  const out = Buffer.alloc(keep.length * el);
  keep.forEach((k, i) => buf.copy(out, i * el, k * el, k * el + el));
  return out;
}

const data = json.accessors.map(read);
// Animation samplers: thin the shared time inputs and every output that uses them.
for (const anim of json.animations ?? []) {
  const inputs = new Set(anim.samplers.map((s) => s.input));
  for (const inp of inputs) {
    const a = json.accessors[inp], times = new Float32Array(data[inp].buffer.slice(data[inp].byteOffset, data[inp].byteOffset + data[inp].length));
    const keep = [];
    let next = -Infinity;
    for (let i = 0; i < times.length; i++) if (times[i] >= next - 1e-4 || i === times.length - 1) { keep.push(i); next = times[i] + 1 / fps; }
    data[inp] = pick(data[inp], 4, keep);
    a.count = keep.length;
    for (const s of anim.samplers) if (s.input === inp) {
      const o = json.accessors[s.output], el = SIZE[o.type] * BYTES[o.componentType];
      // Linear and step samplers have one output per key (cubic splines have three; leave those whole).
      if (s.interpolation === 'CUBICSPLINE') throw new Error('cubic-spline clips are not thinned');
      data[s.output] = pick(data[s.output], el, keep);
      o.count = keep.length;
    }
  }
}

// Repack: one buffer view per accessor, 4-byte aligned.
const parts = [];
let off = 0;
json.bufferViews = json.accessors.map((a, i) => {
  const pad = (4 - (off % 4)) % 4;
  if (pad) { parts.push(Buffer.alloc(pad)); off += pad; }
  const view = { buffer: 0, byteOffset: off, byteLength: data[i].length };
  a.bufferView = i;
  delete a.byteOffset;
  parts.push(data[i]);
  off += data[i].length;
  return view;
});
// Index buffers and vertex attributes keep their targets (helps some loaders).
for (const m of json.meshes) for (const p of m.primitives) {
  if (p.indices !== undefined) json.bufferViews[p.indices].target = 34963;
  for (const v of Object.values(p.attributes)) json.bufferViews[v].target = 34962;
}
let body = Buffer.concat(parts);
if (body.length % 4) body = Buffer.concat([body, Buffer.alloc(4 - (body.length % 4))]);
json.buffers = [{ byteLength: body.length }];

let text = Buffer.from(JSON.stringify(json));
if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + text.length + 8 + body.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(text.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(body.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(dst, Buffer.concat([header, jh, text, bh, body]));
console.log(`${src} ${(glb.length / 1e6).toFixed(2)} MB -> ${dst} ${((12 + 16 + text.length + body.length) / 1e6).toFixed(2)} MB at ${fps} fps`);
