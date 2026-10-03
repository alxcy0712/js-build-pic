import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, test } from 'node:test';
import sharp from 'sharp';
import { ROOT, createScene, encode, hasGlyph, validateScene } from '../scripts/render.mjs';
import { CHARSETS, glyphForCell } from '../scripts/glyphs.mjs';
import { createMask } from '../scripts/mask.mjs';
import { verify } from '../scripts/verify.mjs';

await mkdir(join(ROOT, 'runs'), { recursive: true });
const directory = await mkdtemp(join(ROOT, 'runs', 'test-subject-focus '));
await mkdir(join(directory, 'runs'));
after(() => rm(directory, { recursive: true, force: true }));
const input = join(directory, 'source.png'), mask = join(directory, 'mask.png');
const rgb = [191, 122, 75];
await writeFile(input, await sharp({ create: { width: 192, height: 128, channels: 3,
  background: { r: rgb[0], g: rgb[1], b: rgb[2] },
} }).png().toBuffer());
await writeFile(mask, await createMask(192, 128, [[0.25,0.1],[0.75,0.1],[0.75,0.9],[0.25,0.9]]));
const options = { width: 768, columns: 64, background: 'black', subjectMask: mask };

test('subject focus keeps all subject cells, increases ink and sparsifies background independently of charset', async () => {
  const binary = await createScene(input, options);
  const mixed = await createScene(input, { ...options, charset: 'mixed' });
  assert.equal(binary.variant, 'subject-focus');
  const subject = binary.cells.filter(cell => cell.subject === 255);
  const background = binary.cells.filter(cell => cell.subject === 0);
  assert.ok(subject.length > 0 && background.length > 0);
  assert.ok(subject.every(cell => hasGlyph(binary, cell) && cell.weight === 'bold'));
  const ratio = background.filter(cell => cell.visible).length / background.length;
  assert.ok(ratio > 0.21 && ratio < 0.29, `Background retention: ${ratio}`);
  for (const cell of subject) {
    const area = glyph => glyph.join('').replaceAll('0', '').length;
    assert.ok(area(glyphForCell(binary, cell)) > area(glyphForCell(binary, { ...cell, weight: 'regular' })));
  }
  assert.deepEqual(binary.cells.map(cell => cell.visible), mixed.cells.map(cell => cell.visible));
  assert.ok(binary.cells.every(cell => JSON.stringify(cell.rgb) === JSON.stringify(rgb) && cell.alpha === 255));
  await verify(binary, await encode(binary));
  await verify(mixed, await encode(mixed));
});

test('mixed mode is deterministic, includes letters/digits/symbols and enforces its whitelist', async () => {
  const scene = await createScene(input, { ...options, charset: 'mixed' });
  const chars = scene.cells.map(cell => cell.char).join('');
  assert.match(chars, /[A-Z]/); assert.match(chars, /[0-9]/); assert.match(chars, /[@#$%&*+=?]/);
  assert.ok([...chars].every(char => CHARSETS.mixed.includes(char)));
  assert.deepEqual(await encode(scene), await encode(await createScene(input, { ...options, charset: 'mixed' })));
  for (const char of ['中', ' ', 'AB', '\n']) {
    const bad = structuredClone(scene); bad.cells[0].char = char;
    assert.throws(() => validateScene(bad), /strict_charset/);
  }
  const binary = await createScene(input, options); binary.cells[0].char = 'A';
  assert.throws(() => validateScene(binary), /strict_01/);
  const plain = await createScene(input, { width: 192, columns: 16, charset: 'mixed' });
  assert.equal(plain.focus, null);
  assert.ok(plain.cells.every(cell => cell.visible && cell.weight === 'regular'));
  await verify(plain, await encode(plain));
});

test('density endpoints, seed and soft edges preserve declared focus semantics', async () => {
  const zero = await createScene(input, { ...options, backgroundDensity: 0 });
  const full = await createScene(input, { ...options, backgroundDensity: 1 });
  assert.ok(zero.cells.filter(cell => cell.subject === 0).every(cell => !cell.visible));
  assert.ok(full.cells.every(cell => cell.visible));
  const regular = await createScene(input, options);
  const other = await createScene(input, { ...options, seed: 43 });
  assert.notDeepEqual(regular.cells.map(cell => cell.visible), other.cells.map(cell => cell.visible));
  assert.ok(regular.cells.some(cell => cell.subject > 0 && cell.subject < 255));
  for (const property of ['visible', 'weight']) {
    const bad = structuredClone(regular);
    bad.cells[0][property] = property === 'visible' ? !bad.cells[0].visible : 'bold';
    assert.throws(() => validateScene(bad), /focus/);
  }
  const legacy = await createScene(input, { width: 192, columns: 16 });
  legacy.cells[0].weight = 'bold';
  assert.throws(() => validateScene(legacy), /schema 3/);
});

test('mixed focus verifies alpha, green rendering, fractional grids and catches modified PNG pixels', async () => {
  const alphaInput = join(directory, 'alpha.png');
  await writeFile(alphaInput, await sharp({ create: { width: 192, height: 128, channels: 4,
    background: { r: 191, g: 122, b: 75, alpha: 0.5 },
  } }).png().toBuffer());
  const scene = await createScene(alphaInput, { ...options, width: 397, columns: 32, charset: 'mixed', background: 'transparent' });
  assert.ok(scene.cells.every(cell => cell.alpha === 128));
  const png = await encode(scene);
  const report = await verify(scene, png);
  assert.equal(report.structure_check, 'strict_charset');
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  data[0] ^= 255;
  await assert.rejects(verify(scene, await sharp(data, { raw: info }).png().toBuffer()), /strict_charset/);
  const green = await createScene(input, { ...options, colorMode: 'green', charset: 'mixed' });
  await verify(green, await encode(green));
});

test('mask validation rejects mismatched, transparent, colored and active-format masks', async () => {
  for (const [name, bytes] of [
    ['small.png', await createMask(32,32,[[0,0],[1,0],[1,1],[0,1]])],
    ['alpha.png', await sharp({create:{width:192,height:128,channels:4,background:'#ffffff80'}}).png().toBuffer()],
    ['color.png', await sharp({create:{width:192,height:128,channels:3,background:'#ff0000'}}).png().toBuffer()],
    ['vector.svg', Buffer.from('<svg/>')],
  ]) {
    const path = join(directory, name); await writeFile(path, bytes);
    await assert.rejects(createScene(input, { ...options, subjectMask: path }), /mask/);
  }
  for (const charset of ['unknown', 'constructor', '__proto__']) await assert.rejects(createScene(input, { charset }), /charset/);
  for (const backgroundDensity of [-1, 2, NaN]) await assert.rejects(createScene(input, { ...options, backgroundDensity }), /density/);
});

test('polygon masks have the declared bounds and reject empty or malformed selections', async () => {
  const bytes = await createMask(10, 10, [[0.2,0.2],[0.8,0.2],[0.8,0.8],[0.2,0.8]]);
  const pixels = await sharp(bytes).greyscale().raw().toBuffer();
  assert.equal([...pixels].filter(value => value === 255).length, 36);
  assert.equal(pixels[0], 0); assert.equal(pixels[55], 255);
  for (const points of [[], [[0,0],[1,0],[2,1]], [[0,0],[0,0],[0,0]]]) await assert.rejects(createMask(10,10,points), /Polygon/);
});

test('CLI mask, mixed focus and verification run from an independent working directory', async () => {
  const run = promisify(execFile);
  const polygon = join(directory, 'polygon.json');
  await writeFile(polygon, JSON.stringify([[0.25,0.1],[0.75,0.1],[0.75,0.9],[0.25,0.9]]));
  const script = name => fileURLToPath(new URL(`../scripts/${name}.mjs`, import.meta.url));
  await run(process.execPath, [script('mask'), '--width','192','--height','128','--polygon',polygon,'--out',join(directory,'runs/mask')], {cwd:directory});
  await run(process.execPath, [script('render'), '--input',input,'--out',join(directory,'runs/art'),'--width','192','--columns','16',
    '--charset','mixed','--subject-mask',join(directory,'runs/mask/subject-mask.png'),'--background-density','0.25'], {cwd:directory});
  await run(process.execPath, [script('verify'),'--run',join(directory,'runs/art')], {cwd:directory});
  const manifest = JSON.parse(await readFile(join(directory,'runs/art/manifest.json'),'utf8'));
  assert.equal(manifest.checks.find(check => check.name === 'strict_charset').status, 'pass');
  assert.equal(manifest.input_refs_or_hashes[1].role, 'subject_mask');
  await assert.rejects(run(process.execPath, [script('render'),'--input',input,'--out',join(directory,'runs/invalid'),'--background-density','0.25'], {cwd:directory}), /requires --subject-mask/);
});
