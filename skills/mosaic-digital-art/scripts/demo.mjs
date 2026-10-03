import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { reserveOutput, sha256 } from './render.mjs';
import { createMask } from './mask.mjs';

// Original local colour fixture: three shaded discs on a warm neutral canvas.
// The package can exercise the whole pipeline without downloading source art.
const width = 768, height = 512;
const pixels = Buffer.alloc(width * height * 4);
const colours = [[233, 59, 67], [42, 117, 216], [228, 161, 35]];
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  let rgb = [245, 238, 226];
  for (let j = 0; j < colours.length; j++) {
    const dx = (x - (144 + j * 240)) / 104, dy = (y - 256) / 104;
    if (dx * dx + dy * dy <= 1) {
      const light = Math.max(0.25, Math.min(1, 0.62 + 0.3 * Math.sqrt(1 - dx * dx - dy * dy) - 0.18 * dx - 0.18 * dy));
      rgb = colours[j].map(channel => Math.round(channel * light));
    }
  }
  pixels.set([...rgb, 255], (y * width + x) * 4);
}
const directory = await reserveOutput(`runs/demo-${Date.now()}`);
const source = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
await writeFile(resolve(directory, 'source.png'), source, { flag: 'wx' });
await writeFile(resolve(directory, 'source.json'), JSON.stringify({
  role: 'content_image', origin: 'Original procedural colour fixture from scripts/demo.mjs',
  external_assets: false, sha256: sha256(source), purpose: 'Local self-contained demonstration and validation',
}, null, 2) + '\n', { flag: 'wx' });
const run = promisify(execFile);
await run(process.execPath, [fileURLToPath(new URL('./render.mjs', import.meta.url)),
  '--input', resolve(directory, 'source.png'), '--out', resolve(directory, 'render'), '--width', '1152', '--columns', '96']);
await run(process.execPath, [fileURLToPath(new URL('./verify.mjs', import.meta.url)), '--run', resolve(directory, 'render')]);
const checks = JSON.parse(await readFile(resolve(directory, 'render/checks.json')));
const points = Array.from({ length: 32 }, (_, i) => {
  const angle = 2 * Math.PI * i / 32;
  return [(384 + 105 * Math.cos(angle)) / width, (256 + 105 * Math.sin(angle)) / height];
});
await writeFile(resolve(directory, 'subject-mask.png'), await createMask(width, height, points), { flag: 'wx' });
const focused = [];
for (const charset of ['binary', 'mixed']) {
  const target = resolve(directory, `focus-${charset}`);
  await run(process.execPath, [fileURLToPath(new URL('./render.mjs', import.meta.url)),
    '--input', resolve(directory, 'source.png'), '--out', target, '--width', '1152', '--columns', '96',
    '--charset', charset, '--subject-mask', resolve(directory, 'subject-mask.png')]);
  await run(process.execPath, [fileURLToPath(new URL('./verify.mjs', import.meta.url)), '--run', target]);
  const report = JSON.parse(await readFile(resolve(target, 'checks.json')));
  focused.push({ charset, image: resolve(target, 'image.png'), status: report.status, sha256: report.png_sha256 });
}
const shapeTarget = resolve(directory, 'shapes');
await run(process.execPath, [fileURLToPath(new URL('./shapes.mjs', import.meta.url)),
  '--input', resolve(directory, 'source.png'), '--out', shapeTarget, '--width', '1152', '--columns', '96',
  '--subject-mask', resolve(directory, 'subject-mask.png')]);
await run(process.execPath, [fileURLToPath(new URL('./shapes.mjs', import.meta.url)), '--run', shapeTarget]);
const shapes = JSON.parse(await readFile(resolve(shapeTarget, 'checks.json')));
const gifTarget = resolve(directory, 'subject-gif');
// These two authored plans are tied to this demo's blue disc and green leaf fixtures.
const discDesign = { image_index:1, label:'Blue disc', reason:'The selected central demo object is a shaded blue disc.',
  parts:[{ polygon:Array.from({length:24},(_,i)=>[.5+.4*Math.cos(i*Math.PI/12),.5+.4*Math.sin(i*Math.PI/12)]), source_region:[0,0,1,1] }] };
const leafDesign = { image_index:2, label:'Pointed green leaf', reason:'The second demo fixture is an elongated green diamond with pointed ends.',
  parts:[{polygon:[[.08,.54],[.45,.26],[.92,.46],[.55,.74]],source_region:[0,0,1,1]}] };
await writeFile(resolve(directory,'disc-design.json'),JSON.stringify([discDesign])+'\n',{flag:'wx'});
await writeFile(resolve(directory,'sequence-designs.json'),JSON.stringify([discDesign,leafDesign])+'\n',{flag:'wx'});
await run(process.execPath, [fileURLToPath(new URL('./animate.mjs', import.meta.url)),
  '--input', resolve(directory, 'source.png'), '--subject-mask', resolve(directory, 'subject-mask.png'),
  '--representation', 'irregular-shapes', '--resolution', 'low', '--designs',resolve(directory,'disc-design.json'),'--out', gifTarget]);
const highTarget = resolve(directory, 'high-resolution');
await run(process.execPath, [fileURLToPath(new URL('./animate.mjs', import.meta.url)),
  '--input', resolve(directory, 'source.png'), '--subject-mask', resolve(directory, 'subject-mask.png'),
  '--representation', 'irregular-shapes', '--resolution', 'high', '--format', 'png', '--out', highTarget]);
const leaf = await createMask(width, height, [[.2,.5],[.45,.25],[.8,.5],[.55,.75]]);
await writeFile(resolve(directory, 'leaf-mask.png'), leaf, { flag: 'wx' });
await writeFile(resolve(directory, 'leaf.png'), await sharp({ create: { width, height, channels: 3, background: '#23a894' } }).png().toBuffer(), { flag: 'wx' });
await writeFile(resolve(directory, 'images.json'), JSON.stringify([
  { input: 'source.png', subject_mask: 'subject-mask.png' },
  { input: 'leaf.png', subject_mask: 'leaf-mask.png' },
]) + '\n', { flag: 'wx' });
const sequenceTarget = resolve(directory, 'subject-sequence');
await run(process.execPath, [fileURLToPath(new URL('./animate.mjs', import.meta.url)),
  '--images', resolve(directory, 'images.json'), '--representation', 'characters',
  '--width', '192', '--columns', '24','--designs',resolve(directory,'sequence-designs.json'), '--out', sequenceTarget]);
const animated = await Promise.all([gifTarget, sequenceTarget].map(async target => ({
  gif: resolve(target, 'animation.gif'), status: JSON.parse(await readFile(resolve(target, 'checks.json'))).status,
})));
console.log(JSON.stringify({ directory, image: resolve(directory, 'render/image.png'), status: checks.status,
  colour_mode: checks.color_mode, sha256: checks.png_sha256, subject_focus: focused,
  irregular_shapes: { image: resolve(shapeTarget, 'image.png'), status: shapes.status, sha256: shapes.png_sha256 },
  high_resolution: { image: resolve(highTarget, 'image-1.png'), status: JSON.parse(await readFile(resolve(highTarget, 'checks.json'))).status }, animated }, null, 2));
