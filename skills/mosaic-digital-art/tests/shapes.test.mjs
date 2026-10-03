import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, test } from 'node:test';
import sharp from 'sharp';
import { ROOT, createScene } from '../scripts/render.mjs';
import { createMask } from '../scripts/mask.mjs';
import { createShapes, encodeShapes, verifyShapes } from '../scripts/shapes.mjs';

await mkdir(join(ROOT, 'runs'), { recursive: true });
const directory = await mkdtemp(join(ROOT, 'runs', 'test-shapes '));
await mkdir(join(directory, 'runs'));
after(() => rm(directory, { recursive: true, force: true }));
const input = join(directory, 'source.png'), mask = join(directory, 'mask.png');
await writeFile(input, await sharp({ create: { width: 192, height: 128, channels: 4, background: '#be794b80' } }).png().toBuffer());
await writeFile(mask, await createMask(192, 128, [[.25,.1],[.75,.1],[.75,.9],[.25,.9]]));
const options = { width: 384, columns: 32, subjectMask: mask };

test('shapes use a single polygon vocabulary, preserving sampled colours, alpha and subject visibility', async () => {
  const scene = await createShapes(input, options), samples = await createScene(input, options);
  assert.equal(scene.representation, 'irregular-shapes');
  scene.cells.forEach((cell, i) => {
    assert.deepEqual(cell.rgb, samples.cells[i].rgb); assert.equal(cell.alpha, samples.cells[i].alpha);
    assert.equal(cell.visible, samples.cells[i].visible); assert.equal(cell.points.length, 6);
    assert.ok(!Object.hasOwn(cell, 'char'));
  });
  assert.deepEqual(scene, await createShapes(input, options));
  assert.notDeepEqual(scene.cells[0].points, (await createShapes(input, { ...options, seed: 43 })).cells[0].points);
  const png = await encodeShapes(scene); await verifyShapes(scene, png);
  const pixels = await sharp(png).ensureAlpha().raw().toBuffer();
  assert.ok(pixels.some((value, i) => i % 4 === 3 && value === 128));
  assert.ok(pixels.some((value, i) => i % 4 === 3 && value === 0));
});

test('shape verification rejects added characters, invalid geometry and added raster content', async () => {
  const scene = await createShapes(input, options), png = await encodeShapes(scene);
  const mixed = structuredClone(scene); mixed.cells[0].char = '1';
  await assert.rejects(verifyShapes(mixed, png));
  const invalid = structuredClone(scene); invalid.cells[0].points[0][0] = NaN;
  await assert.rejects(verifyShapes(invalid, png));
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  data[0] ^= 255;
  await assert.rejects(verifyShapes(scene, await sharp(data, { raw: info }).png().toBuffer()), /strict_shapes/);
});

test('shape CLI runs independently, enforces output boundaries and invalidates tampered artifacts', async () => {
  const run = promisify(execFile), script = fileURLToPath(new URL('../scripts/shapes.mjs', import.meta.url));
  const args = [script, '--input', input, '--out', join(directory,'runs/shapes'), '--width', '192', '--columns', '16'];
  await run(process.execPath, args, { cwd: directory });
  await run(process.execPath, [script,'--run',join(directory,'runs/shapes')], { cwd: directory });
  await assert.rejects(run(process.execPath, args, { cwd: directory }));
  await assert.rejects(run(process.execPath, [script,'--input',input,'--out','outside'], { cwd: directory }), /Output/);
  const target = join(directory,'runs/shapes/image.png');
  await writeFile(target, await sharp({create:{width:192,height:128,channels:3,background:'red'}}).png().toBuffer());
  await assert.rejects(run(process.execPath, [script,'--run',join(directory,'runs/shapes')], { cwd: directory }), /strict_shapes/);
  assert.equal(JSON.parse(await readFile(join(directory,'runs/shapes/checks.json'))).status, 'fail');
});
