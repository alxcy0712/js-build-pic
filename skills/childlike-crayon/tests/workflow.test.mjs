import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import sharp from 'sharp';
import { finish, prepare, readImage, reserveOutput, ROOT } from '../scripts/workflow.mjs';

const scene = '按当前输入保留核心视觉结构、布局关系与主色。';
async function fixture(t) {
  await mkdir(resolve(ROOT, 'runs'), { recursive: true });
  const directory = await mkdtemp(resolve(ROOT, 'runs', 'test 中文 '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'source.png');
  await png(input, '#c34b3f');
  return { directory, input, out: join(directory, 'render') };
}
async function png(path, background, width = 90, height = 60) {
  await sharp({ create: { width, height, channels: 4, background } }).png().toFile(path);
}

test('prepare normalizes orientation and removes EXIF while preserving displayed proportions', async t => {
  const { directory, out } = await fixture(t);
  const input = join(directory, 'rotated.jpg');
  await sharp({ create: { width: 80, height: 40, channels: 3, background: '#c86' } })
    .withMetadata({ orientation: 6 }).jpeg().toFile(input);
  const result = await prepare(input, out, scene, 'medium');
  const meta = await sharp(result.input).metadata();
  assert.equal(meta.width, 40);
  assert.equal(meta.height, 80);
  assert.equal(meta.exif, undefined);
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json')));
  assert.deepEqual([manifest.source.width, manifest.source.height], [40, 80]);
  assert.equal(result.status, 'awaiting_generation');
});

test('transparent content uses the agreed light paper and stays opaque', async t => {
  const { input, out } = await fixture(t);
  await png(input, { r: 255, g: 0, b: 0, alpha: 0 });
  const result = await prepare(input, out, scene, 'medium');
  const pixels = await sharp(result.input).raw().toBuffer();
  assert.deepEqual([...pixels.subarray(0, 3)], [250, 247, 239]);
  assert.equal((await sharp(result.input).stats()).isOpaque, true);
});

test('large inputs are resized proportionally without enlarging small sources', async t => {
  const { input, out } = await fixture(t);
  await png(input, '#8ba', 2000, 1000);
  const result = await prepare(input, out, scene, 'medium');
  const meta = await sharp(result.input).metadata();
  assert.deepEqual([meta.width, meta.height], [1536, 768]);
});

test('active formats, corrupt image data and oversized files are rejected', async t => {
  const { directory } = await fixture(t);
  const active = join(directory, 'active.png');
  await writeFile(active, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await assert.rejects(readImage(active), /PNG, JPEG or static WebP/);
  await writeFile(active, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await assert.rejects(readImage(active));
  await truncate(active, 25 * 1024 * 1024 + 1);
  await assert.rejects(readImage(active), /25 MiB/);
});

test('preparation preserves scene notes literally and requires meaningful notes', async t => {
  const { input, out, directory } = await fixture(t);
  const notes = scene + ' 标记 $& 与 {{RATIO}}。';
  await prepare(input, out, notes, 'medium');
  assert.ok((await readFile(join(out, 'prompt.txt'), 'utf8')).includes(notes));
  await assert.rejects(prepare(input, join(directory, 'empty'), ' '), /Scene notes/);
});

test('omitted drawing level waits for a choice before preparing any output', async t => {
  const { input, out, directory } = await fixture(t);
  const pending = await prepare(input, out, scene);
  assert.equal(pending.status, 'awaiting_drawing_level');
  assert.deepEqual(pending.options.map(option => option.value), ['medium', 'low', 'high']);
  assert.equal(pending.drawing_level, undefined);
  assert.equal(pending.directory, undefined);
  await assert.rejects(stat(out), { code: 'ENOENT' });
  const withoutImage = await prepare(join(directory, 'missing.png'), out, scene);
  assert.equal(withoutImage.status, 'awaiting_drawing_level');
  const selected = await prepare(input, out, scene, 'medium');
  assert.equal(selected.status, 'awaiting_generation');
  assert.equal(JSON.parse(await readFile(join(out, 'manifest.json'))).drawing_level, 'medium');
});

test('all drawing levels change the prompt while preserving input and literal content notes', async t => {
  const { input, directory } = await fixture(t);
  const prompts = new Set(), inputHashes = new Set();
  const notes = scene + ' Literal tokens: $& {{LEVEL_GUIDANCE}} {{SCENE}}.';
  for (const level of ['low', 'medium', 'high']) {
    const out = join(directory, level);
    const result = await prepare(input, out, notes, level);
    const manifest = JSON.parse(await readFile(join(out, 'manifest.json')));
    const prompt = await readFile(result.prompt, 'utf8');
    assert.equal(manifest.drawing_level, level);
    assert.deepEqual(manifest.generation_policy, { image_count: 1, automatic_retry_limit: 0 });
    assert.equal(result.drawing_level, level);
    assert.ok(prompt.includes(notes));
    prompts.add(prompt);
    inputHashes.add(manifest.input.sha256);
  }
  assert.equal(prompts.size, 3);
  assert.equal(inputHashes.size, 1);
});

test('invalid drawing levels fail before reserving an output directory', async t => {
  const { input, out } = await fixture(t);
  for (const level of ['expert', '__proto__', null]) {
    await assert.rejects(prepare(input, out, scene, level), /Drawing level/);
    await assert.rejects(stat(out), { code: 'ENOENT' });
  }
});

test('existing directories and paths outside the output roots stay untouched', async t => {
  const { out } = await fixture(t);
  await reserveOutput(out);
  await writeFile(join(out, 'keep.txt'), 'keep');
  await assert.rejects(reserveOutput(out), /EEXIST/);
  await assert.rejects(reserveOutput(resolve(ROOT, 'unapproved-output')), /subdirectory/);
  await assert.rejects(reserveOutput('outputs/unapproved'), /subdirectory/);
  await assert.rejects(reserveOutput(resolve(ROOT, '../../runs/unapproved')), /subdirectory/);
  assert.equal(await readFile(join(out, 'keep.txt'), 'utf8'), 'keep');
});

test('output symlinks cannot redirect writes outside the output range', async t => {
  const { directory } = await fixture(t);
  const external = await mkdtemp(join(tmpdir(), 'crayon-external-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  const link = join(directory, 'link');
  await symlink(external, link, 'dir');
  await assert.rejects(reserveOutput(join(link, 'escaped')), /escapes/);
});

test('finish rejects wrong aspect ratio and preserves the run for a user-requested revision', async t => {
  const { input, out, directory } = await fixture(t);
  await prepare(input, out, scene, 'medium');
  const generated = join(directory, 'wrong.png');
  await png(generated, '#abd', 90, 90);
  await assert.rejects(finish(out, generated), /aspect ratio/);
  assert.equal(JSON.parse(await readFile(join(out, 'manifest.json'))).status, 'awaiting_generation');
});

test('finish detects source/prompt tampering and unchanged output', async t => {
  const { input, out } = await fixture(t);
  const result = await prepare(input, out, scene, 'medium');
  await assert.rejects(finish(out, result.input), /unchanged input/);
  await writeFile(join(out, 'prompt.txt'), 'unexpected replacement');
  await assert.rejects(finish(out, result.input), /Prepared input or prompt changed/);
});

test('successful export verifies pixels but leaves semantic review pending', async t => {
  const { input, out, directory } = await fixture(t);
  await prepare(input, out, scene, 'high');
  const generated = join(directory, 'generated.webp');
  await sharp({ create: { width: 180, height: 120, channels: 3, background: '#789' } }).webp().toFile(generated);
  const result = await finish(out, generated);
  assert.equal(result.status, 'awaiting_visual_review');
  const checks = JSON.parse(await readFile(join(out, 'checks.json')));
  assert.equal(checks.status, 'pass');
  assert.equal(checks.childlike_style, 'not_run');
  assert.equal(checks.content_preservation, 'not_run');
  assert.deepEqual([checks.width, checks.height], [180, 120]);
  assert.equal(checks.opaque, true);
  const review = JSON.parse(await readFile(join(out, 'visual-review.json')));
  assert.equal(review.overall, 'not_run');
  assert.equal(review.drawing_level, 'high');
  assert.equal(review.checks.drawing_ability_matches_selection.status, 'not_run');
  assert.equal(review.checks.detail_quality_matches_selection.status, 'not_run');
  assert.equal(review.checks.background_abstraction_matches_selection.status, 'not_run');
  assert.equal(review.checks.incidental_text_matches_selection.status, 'not_run');
  assert.equal(review.user_acceptance, 'pending');
  await assert.rejects(finish(out, generated), /awaiting_generation/);
});

test('exporting a legacy run preserves its unspecified drawing level', async t => {
  const { input, out, directory } = await fixture(t);
  await prepare(input, out, scene, 'medium');
  const manifestPath = join(out, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath));
  manifest.skill.version = '0.1.0';
  delete manifest.drawing_level;
  await writeFile(manifestPath, JSON.stringify(manifest));
  const generated = join(directory, 'generated.png');
  await png(generated, '#abd', 180, 120);
  await finish(out, generated);
  assert.equal(JSON.parse(await readFile(join(out, 'visual-review.json'))).drawing_level, null);
  assert.equal(JSON.parse(await readFile(manifestPath)).drawing_level, undefined);
});

test('CLI prepares and finishes inside the skill from different working directories', async t => {
  const { input, out, directory } = await fixture(t);
  const notes = join(directory, 'scene 中文.txt');
  await writeFile(notes, scene);
  const { stdout } = await promisify(execFile)(process.execPath, [resolve(ROOT, 'scripts/workflow.mjs'),
    'prepare', '--input', input, '--out', relative(ROOT, out), '--scene', notes, '--drawing-level', 'low'], { cwd: tmpdir() });
  assert.equal(JSON.parse(stdout).status, 'awaiting_generation');
  assert.equal(JSON.parse(stdout).drawing_level, 'low');
  assert.equal(JSON.parse(await readFile(join(out, 'manifest.json'))).drawing_level, 'low');
  assert.ok((await readFile(join(out, 'prompt.txt'), 'utf8')).includes(scene));
  const generated = join(directory, 'generated.png');
  await png(generated, '#abc');
  const finished = await promisify(execFile)(process.execPath, [resolve(ROOT, 'scripts/workflow.mjs'),
    'finish', '--run', relative(ROOT, out), '--generated', generated], { cwd: resolve(ROOT, '..') });
  assert.equal(JSON.parse(finished.stdout).image, join(out, 'image.png'));
});

test('demo without task inputs reports usage and partial inputs are rejected', async t => {
  const { input, out } = await fixture(t);
  const run = promisify(execFile);
  const script = resolve(ROOT, 'scripts/demo.mjs');
  const { stdout } = await run(process.execPath, [script], { cwd: tmpdir() });
  assert.equal(JSON.parse(stdout).status, 'awaiting_input');
  assert.equal(JSON.parse(stdout).directory, undefined);
  await assert.rejects(run(process.execPath, [script, '--input', input, '--out', out]), { code: 1 });
  await assert.rejects(stat(out), { code: 'ENOENT' });
});

test('CLI and demo wait for drawing-level selection without preparing output', async t => {
  const { input, out, directory } = await fixture(t);
  const notes = join(directory, 'scene.txt');
  await writeFile(notes, scene);
  for (const entry of [['scripts/workflow.mjs', 'prepare'], ['scripts/demo.mjs']]) {
    const [script, ...command] = entry;
    const { stdout } = await promisify(execFile)(process.execPath, [resolve(ROOT, script), ...command,
      '--input', input, '--scene', notes, '--out', out], { cwd: tmpdir() });
    const pending = JSON.parse(stdout);
    assert.equal(pending.status, 'awaiting_drawing_level');
    assert.deepEqual(pending.options.map(option => option.value), ['medium', 'low', 'high']);
    assert.equal(pending.prompt, undefined);
    await assert.rejects(stat(out), { code: 'ENOENT' });
  }
});

test('demo uses each supplied image and notes independently and forwards the selected level', async t => {
  const { directory } = await fixture(t);
  const cases = [
    { name: 'a', size: [90, 60], color: '#c43', notes: '深色小区域位于左上，大面积留白。', level: 'medium' },
    { name: 'b', size: [60, 90], color: '#47a', notes: '多个区域相互遮挡，重复结构横向延伸。', level: 'low' },
    { name: 'c', size: [80, 80], color: '#6a8', notes: '细碎笔画密集分布，主色由中心向外变化。', level: 'high' },
  ];
  const inputHashes = new Set();
  for (const item of cases) {
    const input = join(directory, `${item.name}.png`);
    const notes = join(directory, `${item.name}.txt`);
    const out = join(directory, item.name);
    await png(input, item.color, ...item.size);
    await writeFile(notes, item.notes);
    const args = [resolve(ROOT, 'scripts/demo.mjs'), '--input', input, '--scene', notes, '--out', out];
    if (item.level) args.push('--drawing-level', item.level);
    const { stdout } = await promisify(execFile)(process.execPath, args, { cwd: tmpdir() });
    const result = JSON.parse(stdout);
    assert.equal(result.status, 'awaiting_generation');
    assert.equal(result.drawing_level, item.level);
    assert.equal(await readFile(join(out, 'scene.txt'), 'utf8'), item.notes + '\n');
    const prompt = await readFile(result.prompt, 'utf8');
    assert.ok(prompt.includes(item.notes));
    for (const other of cases.filter(other => other !== item)) assert.ok(!prompt.includes(other.notes));
    const manifest = JSON.parse(await readFile(join(out, 'manifest.json')));
    assert.deepEqual([manifest.source.width, manifest.source.height], item.size);
    inputHashes.add(manifest.input.sha256);
  }
  assert.equal(inputHashes.size, cases.length);
});
