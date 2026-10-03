import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, test } from 'node:test';
import sharp from 'sharp';
import { ROOT, createScene, encode, reserveOutput, resolveRun, sha256, validateScene } from '../scripts/render.mjs';
import { verify } from '../scripts/verify.mjs';

await mkdir(join(ROOT, 'runs'), { recursive: true });
const directory = await mkdtemp(join(ROOT, 'runs', 'test-render '));
await mkdir(join(directory, 'runs'));
after(() => rm(directory, { recursive: true, force: true }));
const run = promisify(execFile);

async function fixture(name, bytes) {
  const path = join(directory, name);
  await writeFile(path, bytes);
  return path;
}

const opaque = await fixture('opaque.png', await sharp({ create: {
  width: 64, height: 48, channels: 4, background: '#e0e0e0',
} }).png().toBuffer());
const options = { width: 192, columns: 16 };

test('static PNG/JPEG/WebP inputs produce only binary glyphs and verified pixels', async () => {
  for (const format of ['png', 'jpeg', 'webp']) {
    const input = await fixture(`input.${format}`, await sharp(opaque).toFormat(format).toBuffer());
    const scene = await createScene(input, options);
    const report = await verify(scene, await encode(scene));
    assert.deepEqual(report.character_set, ['0', '1']);
    assert.equal(report.unexpected_pixels, 0);
    assert.ok(report.lit_pixels > 0);
    assert.equal(scene.width / scene.height, 64 / 48);
  }
});

test('identical seed and input reproduce exactly; a changed seed changes digit placement', async () => {
  const visibleOptions = { ...options, background: 'black' };
  const a = await createScene(opaque, visibleOptions);
  const b = await createScene(opaque, visibleOptions);
  const c = await createScene(opaque, { ...visibleOptions, seed: 43 });
  assert.deepEqual(a, b);
  assert.equal(sha256(await encode(a)), sha256(await encode(b)));
  assert.notEqual(sha256(await encode(a)), sha256(await encode(c)));
  assert.deepEqual(a.cells.map(c => c.level), c.cells.map(c => c.level));
});

test('source mode preserves exact RGB for primary, mixed, near-black, black and white colours', async () => {
  const colours = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [247, 128, 33], [119, 57, 202], [1, 2, 3], [0, 0, 0], [255, 255, 255]];
  for (const rgb of colours) {
    const input = await fixture(`rgb-${rgb.join('-')}.png`, await sharp({ create: {
      width: 64, height: 48, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] },
    } }).png().toBuffer());
    const scene = await createScene(input, { ...options, background: 'transparent' });
    assert.equal(scene.color_mode, 'source');
    assert.equal(scene.gamma, 1);
    assert.ok(scene.cells.every(cell => JSON.stringify(cell.rgb) === JSON.stringify(rgb)));
    const png = await encode(scene);
    const pixels = await sharp(png).raw().toBuffer();
    let glyphPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) {
      assert.deepEqual([...pixels.subarray(i, i + 4)], [...rgb, 255]);
      glyphPixels++;
    }
    assert.ok(glyphPixels > 0, 'dark and black glyphs remain present');
    await verify(scene, png);
  }
});

test('source background follows a coloured border and preserves black glyphs on it', async () => {
  const bg = [240, 219, 180, 255];
  const pixels = Buffer.alloc(96 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) {
    pixels.set(x >= 24 && x < 72 && y >= 16 && y < 48 ? [0, 0, 0, 255] : bg, (y * 96 + x) * 4);
  }
  const input = await fixture('coloured-border.png', await sharp(pixels, { raw: { width: 96, height: 64, channels: 4 } }).png().toBuffer());
  const scene = await createScene(input, { width: 288, columns: 48 });
  assert.equal(scene.background, 'source');
  assert.deepEqual(scene.background_rgba, bg);
  assert.ok(scene.cells.every(cell => cell.rgb.every((channel, i) => channel >= 0 && channel <= bg[i])), 'Colour boundaries stay within source range without ringing overshoot');
  const png = await encode(scene);
  const decoded = await sharp(png).raw().toBuffer();
  assert.deepEqual([...decoded.subarray(0, 4)], bg);
  let blackPixels = 0;
  for (let i = 0; i < decoded.length; i += 4) if (decoded[i] === 0 && decoded[i + 1] === 0 && decoded[i + 2] === 0 && decoded[i + 3] === 255) blackPixels++;
  assert.ok(blackPixels > 0);
  await verify(scene, png);
});

test('source background preserves transparency and exact RGB for semi-transparent glyphs', async () => {
  const rgb = [201, 91, 37];
  const input = await fixture('colour-alpha.png', await sharp({ create: {
    width: 64, height: 48, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 128 / 255 },
  } }).png().toBuffer());
  const scene = await createScene(input, options);
  assert.deepEqual(scene.background_rgba, [0, 0, 0, 0]);
  const png = await encode(scene);
  const decoded = await sharp(png).raw().toBuffer();
  let count = 0;
  for (let i = 0; i < decoded.length; i += 4) if (decoded[i + 3]) {
    assert.deepEqual([...decoded.subarray(i, i + 4)], [...rgb, 128]);
    count++;
  }
  assert.ok(count > 0);
  await verify(scene, png);
});

test('explicit green mode reproduces the v1 representation and fixed palette', async () => {
  const scene = await createScene(opaque, { ...options, colorMode: 'green' });
  assert.equal(scene.gamma, 0.8);
  assert.deepEqual(scene.palette, [40, 255, 126]);
  const legacy = structuredClone(scene);
  legacy.schema_version = 1;
  delete legacy.color_mode;
  delete legacy.background_rgba;
  assert.deepEqual(await encode(scene), await encode(legacy));
  await verify(legacy, await encode(scene));
});

test('source mode rejects recolouring gamma and malformed RGB values', async () => {
  await assert.rejects(createScene(opaque, { ...options, gamma: 0.8 }), /gamma 1/);
  const scene = await createScene(opaque, options);
  for (const invalid of [[256, 0, 0], [-1, 0, 0], [1, 2], ['255', 0, 0]]) {
    const altered = structuredClone(scene);
    altered.cells[0].rgb = invalid;
    assert.throws(() => validateScene(altered), /RGB/);
  }
  scene.cells[0].rgb = [255, 0, 0];
  await assert.rejects(verify(scene, await encode(await createScene(opaque, options))), /strict_01/);
});

test('transparent source colour stays invisible; semi-transparent glyph alpha survives export', async () => {
  const pixels = Buffer.alloc(64 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
    const offset = (y * 64 + x) * 4;
    pixels.set([255, 255, 255, x < 32 ? 0 : 128], offset);
  }
  const input = await fixture('alpha.png', await sharp(pixels, { raw: { width: 64, height: 32, channels: 4 } }).png().toBuffer());
  for (const background of ['black', 'transparent']) {
    const scene = await createScene(input, { ...options, background });
    const png = await encode(scene);
    await verify(scene, png);
    const decoded = await sharp(png).ensureAlpha().raw().toBuffer();
    for (let y = 0; y < scene.height; y++) for (let x = 0; x < scene.width / 4; x++) {
      const i = (y * scene.width + x) * 4;
      assert.deepEqual([...decoded.subarray(i, i + 4)], [0, 0, 0, background === 'black' ? 255 : 0]);
    }
    if (background === 'transparent') {
      const alphas = new Set(Array.from({ length: decoded.length / 4 }, (_, i) => decoded[i * 4 + 3]));
      assert.ok(alphas.has(0) && alphas.has(128));
    }
  }
});

test('all eight EXIF orientations preserve expected corner positions and display aspect', async () => {
  const w = 64, h = 48;
  const pixels = Buffer.alloc(w * h * 3);
  const levels = [40, 90, 150, 230];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    pixels.fill(levels[(y >= h / 2 ? 2 : 0) + (x >= w / 2 ? 1 : 0)], (y * w + x) * 3, (y * w + x) * 3 + 3);
  }
  const corners = [[0, 1, 2, 3], [1, 0, 3, 2], [3, 2, 1, 0], [2, 3, 0, 1],
    [0, 2, 1, 3], [2, 0, 3, 1], [3, 1, 2, 0], [1, 3, 0, 2]];
  for (let orientation = 1; orientation <= 8; orientation++) {
    const input = await fixture(`orientation-${orientation}.jpg`, await sharp(pixels, { raw: { width: w, height: h, channels: 3 } })
      .withMetadata({ orientation }).jpeg({ quality: 100 }).toBuffer());
    const scene = await createScene(input, { ...options, gamma: 1 });
    assert.equal(scene.height, orientation < 5 ? 144 : 256);
    const positions = [0, scene.columns - 1, (scene.rows - 1) * scene.columns, scene.cells.length - 1];
    positions.forEach((p, i) => assert.ok(Math.abs(scene.cells[p].level - levels[corners[orientation - 1][i]]) <= 2,
      `orientation ${orientation}, corner ${i}`));
    await verify(scene, await encode(scene));
  }
});

test('sampling keeps tonal order and full content bounds for non-square input', async () => {
  const pixels = Buffer.alloc(120 * 40 * 3);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 120; x++) {
    pixels.fill(Math.round(x / 119 * 255), (y * 120 + x) * 3, (y * 120 + x) * 3 + 3);
  }
  const input = await fixture('gradient.png', await sharp(pixels, { raw: { width: 120, height: 40, channels: 3 } }).png().toBuffer());
  const scene = await createScene(input, { width: 240, columns: 20, gamma: 1 });
  assert.equal(scene.height, 80);
  const row = scene.cells.slice(0, scene.columns).map(cell => cell.level);
  assert.ok(row[0] < 10 && row.at(-1) > 245);
  assert.ok(row.every((value, i) => i === 0 || value > row[i - 1]));
  await verify(scene, await encode(scene));
});

test('odd output sizes preserve full glyphs across fractional cell boundaries', async () => {
  const scene = await createScene(opaque, { width: 97, columns: 16 });
  assert.equal(scene.width, 97);
  assert.equal(scene.height, 73);
  await verify(scene, await encode(scene));
});

test('checker rejects other characters, extra image pixels, alpha changes and wrong dimensions', async () => {
  const scene = await createScene(opaque, options);
  const badScene = structuredClone(scene);
  badScene.cells[0].char = '2';
  assert.throws(() => validateScene(badScene), /strict_01/);
  const png = await encode(scene);
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  for (const channel of [0, 3]) {
    const corrupt = Buffer.from(data);
    corrupt[channel] = channel === 0 ? 255 : 0;
    const altered = await sharp(corrupt, { raw: info }).png().toBuffer();
    await assert.rejects(verify(scene, altered), /strict_01/);
  }
  await assert.rejects(verify(scene, await sharp(png).resize(100, 100).png().toBuffer()), /dimensions/);
});

test('unsupported, animated, corrupt and oversized inputs fail before rendering', async () => {
  const svg = await fixture('vector.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'));
  await assert.rejects(createScene(svg, options), /PNG, JPEG or static WebP/);
  const frames = Buffer.alloc(10 * 20 * 3, 255);
  frames.fill(0, 10 * 10 * 3);
  const animated = await fixture('animated.webp', await sharp(frames, { raw: {
    width: 10, height: 20, channels: 3, pageHeight: 10,
  } }).webp({ loop: 0, delay: [100, 100] }).toBuffer());
  await assert.rejects(createScene(animated, options), /Animated/);
  const corrupt = await fixture('broken.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await assert.rejects(createScene(corrupt, options));
  const huge = await fixture('too-many-pixels.png', await sharp({ create: {
    width: 6400, height: 6400, channels: 3, background: 'white',
  } }).png().toBuffer());
  await assert.rejects(createScene(huge, options), /pixel limit/i);
  await assert.rejects(createScene(opaque, { ...options, columns: 128 }), /6 pixels/);
  await assert.rejects(createScene(opaque, { ...options, seed: -1 }), /seed/);
});

test('output guard preserves existing directories and blocks escaped or symlink paths', async () => {
  const base = await mkdtemp(join(directory, 'workspace-'));
  await mkdir(join(base, 'runs'));
  const target = join(base, 'runs', 'new');
  await reserveOutput(target);
  await assert.rejects(reserveOutput(target), /EEXIST/);
  for (const outside of ['../escape', 'outputs/new', resolve(ROOT, '../../runs/new')]) {
    await assert.rejects(reserveOutput(outside), /inside runs/);
    await assert.rejects(resolveRun(outside), /inside runs/);
  }
  await symlink(tmpdir(), join(base, 'runs', 'redirect'));
  await assert.rejects(reserveOutput(join(base, 'runs', 'redirect', 'new')), /escapes/);
  await assert.rejects(resolveRun(join(base, 'runs', 'redirect')), /inside runs/);
});

test('CLI writes verifiable artifacts and rejects a rerun onto the same output', async () => {
  const base = await mkdtemp(join(directory, 'cli 用户任务 '));
  await mkdir(join(base, 'runs'));
  const input = await fixture('内容图 sample.png', await readFile(opaque));
  const renderer = fileURLToPath(new URL('../scripts/render.mjs', import.meta.url));
  const verifier = fileURLToPath(new URL('../scripts/verify.mjs', import.meta.url));
  const target = relative(ROOT, join(base, 'runs/sample'));
  const args = [renderer, '--input', input, '--out', target, '--width', '192', '--columns', '16'];
  const { stdout } = await run(process.execPath, args, { cwd: tmpdir() });
  assert.equal(JSON.parse(stdout).directory, join(base, 'runs/sample'));
  await run(process.execPath, [verifier, '--run', target], { cwd: resolve(ROOT, '..') });
  const report = JSON.parse(await readFile(join(base, 'runs/sample/checks.json')));
  assert.equal(report.status, 'pass');
  await assert.rejects(run(process.execPath, args, { cwd: base }), /EEXIST/);
  const txtPath = join(base, 'runs/sample/glyphs.txt');
  await writeFile(txtPath, '2');
  await assert.rejects(run(process.execPath, [verifier, '--run', target], { cwd: base }), /Text export differs/);
  assert.equal(JSON.parse(await readFile(join(base, 'runs/sample/checks.json'))).status, 'fail');
  assert.equal(JSON.parse(await readFile(join(base, 'runs/sample/manifest.json'))).status, 'verification_failed');
});
