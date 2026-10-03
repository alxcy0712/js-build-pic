import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { createScene, reserveOutput, resolveRun, sha256, validateScene, VERSION, STYLE } from './render.mjs';

export async function createShapes(input, options = {}) {
  const samples = await createScene(input, { ...options, colorMode: 'source', charset: 'binary' });
  validateScene(samples);
  let state = samples.seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const cells = samples.cells.map(cell => ({
    rgb: cell.rgb, alpha: cell.alpha, visible: cell.visible ?? true,
    points: [[.10 + random() * .10, .10 + random() * .10], [.65 + random() * .20, .04 + random() * .08],
      [.90 + random() * .08, .40 + random() * .18], [.70 + random() * .20, .85 + random() * .10],
      [.20 + random() * .20, .90 + random() * .08], [.02 + random() * .08, .45 + random() * .20]],
  }));
  return { schema_version: 1, style: STYLE, representation: 'irregular-shapes',
    width: samples.width, height: samples.height, columns: samples.columns, rows: samples.rows,
    seed: samples.seed, source: samples.source, focus: samples.focus ?? null,
    background_rgba: samples.background_rgba, cells };
}

function validateShapes(scene) {
  assert.equal(scene.schema_version, 1); assert.equal(scene.representation, 'irregular-shapes');
  assert.equal(scene.style, STYLE, 'Unsupported shape style');
  for (const [value, max] of [[scene.width,4096],[scene.height,4096],[scene.columns,256],[scene.rows,1024]])
    assert.ok(Number.isInteger(value) && value > 0 && value <= max, 'Invalid shape dimensions');
  assert.equal(scene.cells.length, scene.columns * scene.rows);
  assert.equal(scene.background_rgba.length, 4);
  for (const value of scene.background_rgba) assert.ok(Number.isInteger(value) && value >= 0 && value <= 255);
  assert.ok([0,255].includes(scene.background_rgba[3]));
  for (const cell of scene.cells) {
    assert.deepEqual(Object.keys(cell).sort(), ['alpha','points','rgb','visible']);
    assert.equal(typeof cell.visible, 'boolean'); assert.equal(cell.rgb.length, 3);
    for (const value of [...cell.rgb,cell.alpha]) assert.ok(Number.isInteger(value) && value >= 0 && value <= 255);
    assert.equal(cell.points.length, 6);
    for (const point of cell.points) assert.ok(point.length === 2 && point.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
  }
}

function inside(points, x, y) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi,yi] = points[i], [xj,yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function rasterizeShapes(scene) {
  validateShapes(scene);
  const { width, height, columns, rows, cells, background_rgba: bg } = scene;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + .5) * columns / width, v = (y + .5) * rows / height;
    const cell = cells[Math.floor(v) * columns + Math.floor(u)];
    const ink = cell.visible && cell.alpha > 0 && inside(cell.points, u % 1, v % 1);
    const offset = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) pixels[offset + c] = ink
      ? Math.round(bg[3] === 255 ? cell.rgb[c] * cell.alpha / 255 + bg[c] * (1 - cell.alpha / 255) : cell.rgb[c]) : bg[c];
    pixels[offset + 3] = bg[3] === 255 ? 255 : ink ? cell.alpha : 0;
  }
  return pixels;
}

export async function encodeShapes(scene) {
  return sharp(rasterizeShapes(scene), { raw: { width: scene.width, height: scene.height, channels: 4 } }).png().toBuffer();
}

export async function verifyShapes(scene, png) {
  const expected = rasterizeShapes(scene);
  const { data, info } = await sharp(png, { limitInputPixels: 4096 * 4096 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, scene.width); assert.equal(info.height, scene.height);
  assert.ok(data.equals(expected), 'strict_shapes: pixels differ from the declared polygon layer');
  return { status: 'pass', structure_check: 'strict_shapes', representation: scene.representation,
    checked_pixels: scene.width * scene.height, png_sha256: sha256(png),
    scope: 'Decoded pixels replay the declared polygon geometry, source RGBA and flat background; visual review is separate.', visual_review: 'not_run' };
}

async function main() {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, out: { type: 'string' }, run: { type: 'string' },
    width: { type: 'string', default: '1536' }, columns: { type: 'string', default: '128' }, seed: { type: 'string', default: '42' },
    background: { type: 'string', default: 'source' }, 'subject-mask': { type: 'string' }, 'background-density': { type: 'string' },
  } });
  if (values.run) {
    const directory = await resolveRun(values.run);
    try {
      const scene = JSON.parse(await readFile(resolve(directory, 'shapes.json')));
      const report = await verifyShapes(scene, await readFile(resolve(directory, 'image.png')));
      const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json')));
      assert.deepEqual(manifest.outputs.map(item => item.path).sort(), ['image.png','shapes.json']);
      for (const output of manifest.outputs) assert.equal(sha256(await readFile(resolve(directory, output.path))), output.sha256);
      await writeFile(resolve(directory, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(report));
    } catch (error) {
      await writeFile(resolve(directory, 'checks.json'), JSON.stringify({ status: 'fail', reason: error.message }) + '\n');
      throw error;
    }
    return;
  }
  if (!values.input || !values.out) throw new Error('--input and --out are required');
  if (values['background-density'] !== undefined && !values['subject-mask']) throw new Error('--background-density requires --subject-mask');
  const scene = await createShapes(values.input, { width: Number(values.width), columns: Number(values.columns), seed: Number(values.seed),
    background: values.background, subjectMask: values['subject-mask'], backgroundDensity: values['background-density'] === undefined ? .25 : Number(values['background-density']) });
  const png = await encodeShapes(scene), report = await verifyShapes(scene, png);
  const directory = await reserveOutput(values.out), shapes = JSON.stringify(scene) + '\n';
  await writeFile(resolve(directory, 'image.png'), png, { flag: 'wx' });
  await writeFile(resolve(directory, 'shapes.json'), shapes, { flag: 'wx' });
  await writeFile(resolve(directory, 'checks.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify({
    skill: { id: scene.style, version: VERSION }, representation: scene.representation, source: scene.source,
    style_spec_ref: null, seed: scene.seed, renderer_sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    environment: { node: process.version, sharp: sharp.versions },
    outputs: [{ path: 'image.png', sha256: sha256(png) }, { path: 'shapes.json', sha256: sha256(shapes) }],
    status: 'rendered', verification_ref: 'checks.json', visual_review: 'not_run',
  }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ directory, ...report }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
