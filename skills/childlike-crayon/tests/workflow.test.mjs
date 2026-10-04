import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import sharp from 'sharp';
import { finish, prepare, readImage, reserveOutput, review, ROOT } from '../scripts/workflow.mjs';

const mark = { type: 'rect', box: [0.1, 0.2, 0.5, 0.4], fill: '#c34b3f' };
const scene = '按当前输入保留核心视觉结构、布局关系与主色。';
function analysis(notes = scene, details = []) {
  return {
    observation: '主要区域的相对位置、主色关系和留白按当前输入表达。',
    core_information: [{ source: '当前输入中的主要色区。', role: '承载整体视觉组织。', depiction: notes, guide_marks: [mark] }],
    optional_details: details.map(item => ({ guide_marks: item.action === 'omit' ? [] : [mark], ...item })),
    grouping_check: '组合的信息保有整体组织与核心含义。',
    plan_check: '原图证据、作用判断、取舍顺序和档位预算已核对。',
  };
}
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
  const result = await prepare(input, out, analysis(), 'medium');
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
  const result = await prepare(input, out, analysis(), 'medium');
  const pixels = await sharp(result.input).raw().toBuffer();
  assert.deepEqual([...pixels.subarray(0, 3)], [250, 247, 239]);
  assert.equal((await sharp(result.input).stats()).isOpaque, true);
});

test('large inputs are resized proportionally without enlarging small sources', async t => {
  const { input, out } = await fixture(t);
  await png(input, '#8ba', 2000, 1000);
  const result = await prepare(input, out, analysis(), 'medium');
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

test('preparation preserves selected descriptions literally and requires a complete analysis', async t => {
  const { input, out, directory } = await fixture(t);
  const notes = scene + ' 标记 $& 与 {{RATIO}}。';
  await prepare(input, out, analysis(notes), 'medium');
  assert.ok((await readFile(join(out, 'prompt.txt'), 'utf8')).includes(notes));
  await assert.rejects(prepare(input, join(directory, 'empty'), analysis(' '), 'medium'), /Core information/);
});

test('omitted drawing level waits for a choice before preparing any output', async t => {
  const { input, out, directory } = await fixture(t);
  const pending = await prepare(input, out, analysis());
  assert.equal(pending.status, 'awaiting_drawing_level');
  assert.deepEqual(pending.options.map(option => option.value), ['medium', 'low', 'high']);
  assert.equal(pending.drawing_level, undefined);
  assert.equal(pending.directory, undefined);
  await assert.rejects(stat(out), { code: 'ENOENT' });
  const withoutImage = await prepare(join(directory, 'missing.png'), out, analysis());
  assert.equal(withoutImage.status, 'awaiting_drawing_level');
  const selected = await prepare(input, out, analysis(), 'medium');
  assert.equal(selected.status, 'awaiting_generation');
  assert.equal(JSON.parse(await readFile(join(out, 'manifest.json'))).drawing_level, 'medium');
});

test('all drawing levels change the prompt while preserving input and literal content notes', async t => {
  const { input, directory } = await fixture(t);
  const prompts = new Set(), inputHashes = new Set();
  const notes = scene + ' Literal tokens: $& {{LEVEL_GUIDANCE}} {{SCENE}}.';
  for (const level of ['low', 'medium', 'high']) {
    const out = join(directory, level);
    const result = await prepare(input, out, analysis(notes), level);
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
    await assert.rejects(prepare(input, out, analysis(), level), /Drawing level/);
    await assert.rejects(stat(out), { code: 'ENOENT' });
  }
});

test('selected level waits for content analysis in API, CLI and demo before creating output', async t => {
  const { input, out } = await fixture(t);
  const pending = await prepare(input, out, undefined, 'medium');
  assert.equal(pending.status, 'awaiting_content_analysis');
  assert.equal(pending.drawing_level, 'medium');
  for (const [script, ...command] of [['scripts/workflow.mjs', 'prepare'], ['scripts/demo.mjs']]) {
    const { stdout } = await promisify(execFile)(process.execPath, [resolve(ROOT, script), ...command,
      '--input', input, '--out', out, '--drawing-level', 'medium'], { cwd: tmpdir() });
    assert.equal(JSON.parse(stdout).status, 'awaiting_content_analysis');
  }
  await assert.rejects(stat(out), { code: 'ENOENT' });
});

test('missing analysis stages and unsupported plan actions fail before preparation', async t => {
  const { input, out } = await fixture(t);
  const invalid = [null, scene, {}];
  for (const key of ['observation', 'grouping_check', 'plan_check', 'core_information', 'optional_details']) {
    const candidate = analysis();
    delete candidate[key];
    invalid.push(candidate);
  }
  invalid.push(analysis(scene, [{ source: '局部区域', importance: '附属信息', action: 'invent', depiction: '新增信息' }]));
  for (const candidate of invalid) {
    await assert.rejects(prepare(input, out, candidate, 'medium'), /Analysis requires|Optional details require/);
    await assert.rejects(stat(out), { code: 'ENOENT' });
  }
});

test('level budgets select ranked optional groups while all core information stays in the prompt', async t => {
  const { input, directory } = await fixture(t);
  for (const [level, selectedCount, target] of [['low', 0, 0.1], ['low', 1, 0.1], ['medium', 5, 0.5], ['high', 8, 0.8]]) {
    const details = Array.from({ length: 10 }, (_, index) => ({
      source: `source-evidence-${index}`, importance: `ranked-contribution-${index}`,
      action: index < selectedCount ? (index % 2 ? 'retain' : 'simplify') : 'omit',
      depiction: index < selectedCount ? `selected-feature-${index}` : '',
    }));
    const plan = analysis('core-cue-$&-{{SCENE}}', details);
    const out = join(directory, `${level}-${selectedCount}`);
    const result = await prepare(input, out, plan, level);
    const prompt = await readFile(result.prompt, 'utf8');
    const manifest = JSON.parse(await readFile(join(out, 'manifest.json')));
    assert.ok(prompt.includes(plan.core_information[0].depiction));
    for (let index = 0; index < 10; index++) assert.equal(prompt.includes(`source-evidence-${index}`), false);
    assert.ok(!prompt.includes('ranked-contribution-'));
    for (let index = 0; index < 10; index++) assert.equal(prompt.includes(`selected-feature-${index}`), index < selectedCount);
    assert.deepEqual(JSON.parse(await readFile(join(out, 'analysis.json'))), plan);
    assert.equal(manifest.detail_budget.pool_group_count, 10);
    assert.equal(manifest.detail_budget.selected_group_count, selectedCount);
    assert.equal(manifest.detail_budget.selected_fraction, selectedCount / 10);
    assert.equal(manifest.detail_budget.target_fraction, target);
  }
});

test('a lower-priority selection, excess detail or omitted depiction cannot enter generation', async t => {
  const { input, out } = await fixture(t);
  const details = Array.from({ length: 10 }, (_, index) => ({ source: `区域${index}`, importance: `贡献${index}`,
    action: index < 5 ? 'simplify' : 'omit', depiction: index < 5 ? `表达${index}` : '' }));
  const lowerPriority = structuredClone(details);
  [lowerPriority[0], lowerPriority[5]] = [lowerPriority[5], lowerPriority[0]];
  await assert.rejects(prepare(input, out, analysis(scene, lowerPriority), 'medium'), /importance order/);
  const excessive = structuredClone(details);
  excessive[5] = { ...excessive[5], action: 'retain', depiction: '额外细节' };
  await assert.rejects(prepare(input, out, analysis(scene, excessive), 'medium'), /group budget/);
  await assert.rejects(prepare(input, out, analysis(scene, details), 'low'), /group budget/);
  const omittedDepiction = structuredClone(details);
  omittedDepiction[9].depiction = '省略项的描述';
  await assert.rejects(prepare(input, out, analysis(scene, omittedDepiction), 'medium'), /empty depiction/);
  await assert.rejects(stat(out), { code: 'ENOENT' });
});

test('small detail pools use discrete budgets and an empty pool keeps its measured fraction unknown', async t => {
  const { input, directory } = await fixture(t);
  const detail = { source: '局部', importance: '辅助贡献', action: 'retain', depiction: '粗略辨识笔画' };
  for (const level of ['medium', 'high']) {
    const out = join(directory, level);
    await prepare(input, out, analysis(scene, [detail]), level);
    const { detail_budget } = JSON.parse(await readFile(join(out, 'manifest.json')));
    assert.equal(detail_budget.target_group_count, 1);
    assert.equal(detail_budget.selected_fraction, 1);
  }
  const out = join(directory, 'empty');
  await prepare(input, out, analysis(), 'low');
  const { detail_budget } = JSON.parse(await readFile(join(out, 'manifest.json')));
  assert.equal(detail_budget.pool_group_count, 0);
  assert.equal(detail_budget.selected_fraction, null);
  await assert.rejects(prepare(input, join(directory, 'excess'), analysis(scene, [detail]), 'low'), /group budget/);
});

test('finish verifies analysis integrity and creates an itemized review without claiming visual success', async t => {
  const { input, out, directory } = await fixture(t);
  const plan = analysis(scene, [
    { source: '第一局部', importance: '较高贡献', action: 'simplify', depiction: '少量粗略特征' },
    { source: '第二局部', importance: '较低贡献', action: 'omit', depiction: '' },
  ]);
  await prepare(input, out, plan, 'medium');
  const saved = await readFile(join(out, 'analysis.json'));
  await writeFile(join(out, 'analysis.json'), JSON.stringify(analysis('修改后的核心')));
  const generated = join(directory, 'generated.png');
  await png(generated, '#789');
  await assert.rejects(finish(out, generated), /content analysis changed/);
  await assert.rejects(stat(join(out, 'image.png')), { code: 'ENOENT' });
  await writeFile(join(out, 'analysis.json'), saved);
  await finish(out, generated);
  const review = JSON.parse(await readFile(join(out, 'visual-review.json')));
  assert.equal(review.content_plan.core_information.length, 1);
  assert.equal(review.content_plan.optional_details.length, 2);
  assert.deepEqual(review.content_plan.optional_details.map(item => item.action), ['simplify', 'omit']);
  assert.ok([...review.content_plan.core_information, ...review.content_plan.optional_details].every(item => item.status === 'not_run'));
  assert.equal(review.overall, 'not_run');
  assert.equal(review.detail_budget.selected_fraction, 0.5);
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
  await prepare(input, out, analysis(), 'medium');
  const generated = join(directory, 'wrong.png');
  await png(generated, '#abd', 90, 90);
  await assert.rejects(finish(out, generated), /aspect ratio/);
  assert.equal(JSON.parse(await readFile(join(out, 'manifest.json'))).status, 'awaiting_generation');
});

test('finish detects source/prompt tampering and unchanged output', async t => {
  const { input, out } = await fixture(t);
  const result = await prepare(input, out, analysis(), 'medium');
  await assert.rejects(finish(out, result.input), /unchanged input/);
  await assert.rejects(finish(out, result.generation_reference), /unchanged generation reference/);
  await writeFile(join(out, 'prompt.txt'), 'unexpected replacement');
  await assert.rejects(finish(out, result.input), /Prepared input or prompt changed/);
});

test('successful export verifies pixels but leaves semantic review pending', async t => {
  const { input, out, directory } = await fixture(t);
  await prepare(input, out, analysis(), 'high');
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
  assert.equal(review.checks.core_information_matches_plan.status, 'not_run');
  assert.equal(review.checks.optional_detail_retention_matches_plan.status, 'not_run');
  assert.equal(review.checks.detail_priority_matches_plan.status, 'not_run');
  assert.equal(review.detail_budget.selected_fraction, null);
  assert.equal(review.content_plan.core_information[0].status, 'not_run');
  assert.equal(review.user_acceptance, 'pending');
  await assert.rejects(finish(out, generated), /awaiting_generation/);
});

test('exporting a legacy run preserves its unspecified drawing level', async t => {
  const { input, out, directory } = await fixture(t);
  await prepare(input, out, analysis(), 'medium');
  const manifestPath = join(out, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath));
  manifest.skill.version = '0.1.0';
  delete manifest.drawing_level;
  delete manifest.content_analysis;
  delete manifest.detail_budget;
  await writeFile(manifestPath, JSON.stringify(manifest));
  const generated = join(directory, 'generated.png');
  await png(generated, '#abd', 180, 120);
  await finish(out, generated);
  const review = JSON.parse(await readFile(join(out, 'visual-review.json')));
  assert.equal(review.drawing_level, null);
  assert.equal(review.detail_budget, null);
  assert.deepEqual(review.content_plan, { core_information: [], optional_details: [] });
  assert.equal(JSON.parse(await readFile(manifestPath)).drawing_level, undefined);
});

test('CLI prepares and finishes inside the skill from different working directories', async t => {
  const { input, out, directory } = await fixture(t);
  const notes = join(directory, 'analysis 中文.json');
  await writeFile(notes, JSON.stringify(analysis()));
  const { stdout } = await promisify(execFile)(process.execPath, [resolve(ROOT, 'scripts/workflow.mjs'),
    'prepare', '--input', input, '--out', relative(ROOT, out), '--analysis', notes, '--drawing-level', 'low'], { cwd: tmpdir() });
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
  const { input, out, directory } = await fixture(t);
  const run = promisify(execFile);
  const script = resolve(ROOT, 'scripts/demo.mjs');
  const { stdout } = await run(process.execPath, [script], { cwd: tmpdir() });
  assert.equal(JSON.parse(stdout).status, 'awaiting_input');
  assert.equal(JSON.parse(stdout).directory, undefined);
  await assert.rejects(run(process.execPath, [script, '--analysis', join(directory, 'missing.json'), '--out', out]), { code: 1 });
  await assert.rejects(stat(out), { code: 'ENOENT' });
});

test('CLI and demo wait for drawing-level selection without preparing output', async t => {
  const { input, out, directory } = await fixture(t);
  const notes = join(directory, 'scene.txt');
  await writeFile(notes, JSON.stringify(analysis()));
  for (const entry of [['scripts/workflow.mjs', 'prepare'], ['scripts/demo.mjs']]) {
    const [script, ...command] = entry;
    const { stdout } = await promisify(execFile)(process.execPath, [resolve(ROOT, script), ...command,
      '--input', input, '--analysis', notes, '--out', out], { cwd: tmpdir() });
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
    const notes = join(directory, `${item.name}.json`);
    const out = join(directory, item.name);
    await png(input, item.color, ...item.size);
    await writeFile(notes, JSON.stringify(analysis(item.notes)));
    const args = [resolve(ROOT, 'scripts/demo.mjs'), '--input', input, '--analysis', notes, '--out', out];
    if (item.level) args.push('--drawing-level', item.level);
    const { stdout } = await promisify(execFile)(process.execPath, args, { cwd: tmpdir() });
    const result = JSON.parse(stdout);
    assert.equal(result.status, 'awaiting_generation');
    assert.equal(result.drawing_level, item.level);
    assert.equal(JSON.parse(await readFile(join(out, 'analysis.json'))).core_information[0].depiction, item.notes);
    assert.ok((await readFile(join(out, 'scene.txt'), 'utf8')).includes(item.notes));
    const prompt = await readFile(result.prompt, 'utf8');
    assert.ok(prompt.includes(item.notes));
    for (const other of cases.filter(other => other !== item)) assert.ok(!prompt.includes(other.notes));
    const manifest = JSON.parse(await readFile(join(out, 'manifest.json')));
    assert.deepEqual([manifest.source.width, manifest.source.height], item.size);
    inputHashes.add(manifest.input.sha256);
  }
  assert.equal(inputHashes.size, cases.length);
});

test('the generation reference contains exactly planned marks and omitted evidence stays local', async t => {
  const { input, out } = await fixture(t);
  const selected = { type: 'ellipse', box: [0.65, 0.1, 0.2, 0.2], fill: '#00ff00' };
  const plan = analysis(scene, [
    { source: 'selected source evidence', importance: 'higher', action: 'retain', depiction: 'selected cue', guide_marks: [selected] },
    { source: 'omitted private inscription', importance: 'lower', action: 'omit', depiction: '', guide_marks: [] },
  ]);
  const result = await prepare(input, out, plan, 'medium');
  const guide = await sharp(result.generation_reference).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => [...guide.data.subarray((y * guide.info.width + x) * guide.info.channels, (y * guide.info.width + x) * guide.info.channels + 3)];
  assert.deepEqual(at(20, 20), [195, 75, 63]);
  assert.deepEqual(at(65, 12), [0, 255, 0]);
  assert.deepEqual(at(85, 55), [250, 247, 239]);
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json')));
  assert.equal(manifest.generation_reference.mark_count, 2);
  assert.equal(manifest.core_reference.mark_count, 1);
  const core = await sharp(result.core_reference).raw().toBuffer({ resolveWithObject: true });
  const corePixel = [...core.data.subarray((12 * core.info.width + 65) * core.info.channels, (12 * core.info.width + 65) * core.info.channels + 3)];
  assert.deepEqual(corePixel, [250, 247, 239]);
  const prompt = await readFile(result.prompt, 'utf8');
  assert.ok(prompt.includes('selected cue'));
  assert.ok(!prompt.includes('omitted private inscription'));
  assert.equal(JSON.parse(await readFile(join(out, 'analysis.json'))).optional_details[1].source, 'omitted private inscription');
});

test('minimum internal structural cues remain in the core-only reference across all detail budgets', async t => {
  const { input, directory } = await fixture(t);
  const hashes = new Set();
  for (const [level, count] of [['low', 0], ['medium', 5], ['high', 8]]) {
    const plan = analysis(scene, Array.from({ length: 10 }, (_, i) => ({
      source: `Accessory group ${i}`, importance: `Rank ${i}`,
      action: i < count ? 'simplify' : 'omit', depiction: i < count ? 'Accessory mark' : '',
      guide_marks: i < count ? [{ type: 'rect', box: [0.8, 0.1, 0.1, 0.1], fill: '#0000ff' }] : [],
    })));
    plan.core_information.push({ source: 'Internal division inside the main mass', role: 'Minimum source structure', depiction: 'One rough internal cue',
      guide_marks: [{ type: 'rect', box: [0.3, 0.3, 0.1, 0.1], fill: '#123456' }] });
    const result = await prepare(input, join(directory, level), plan, level);
    const manifest = JSON.parse(await readFile(join(result.directory, 'manifest.json')));
    hashes.add(manifest.core_reference.sha256);
    const { data, info } = await sharp(result.core_reference).raw().toBuffer({ resolveWithObject: true });
    const offset = (21 * info.width + 31) * info.channels;
    assert.deepEqual([...data.subarray(offset, offset + 3)], [18, 52, 86]);
    assert.equal(manifest.detail_budget.selected_group_count, count);
  }
  assert.equal(hashes.size, 1);
});

test('invalid guide primitives and marks on omitted groups fail before creating output', async t => {
  const { input, out } = await fixture(t);
  for (const invalid of [[], [{ ...mark, type: 'image', href: 'remote' }], [{ ...mark, fill: 'url(secret)' }],
    [{ ...mark, box: [0.9, 0.2, 0.5, 0.4] }], [{ type: 'line', points: [[0, 0], [1, 1]], stroke: '#000000', width: 0 }]]) {
    const plan = analysis();
    plan.core_information[0].guide_marks = invalid;
    await assert.rejects(prepare(input, out, plan, 'low'), /Guide/);
  }
  await assert.rejects(prepare(input, out, analysis(scene, [{ source: 'region', importance: 'low', action: 'omit', depiction: '', guide_marks: [mark] }]), 'low'), /empty guide marks/);
  await assert.rejects(stat(out), { code: 'ENOENT' });
});

test('export checks the task-derived reference integrity', async t => {
  const { input, out, directory } = await fixture(t);
  const result = await prepare(input, out, analysis(), 'medium');
  const generated = join(directory, 'generated.png');
  await png(generated, '#789');
  const core = await readFile(result.core_reference);
  await png(result.core_reference, '#321');
  await assert.rejects(finish(out, generated), /core reference changed/);
  await writeFile(result.core_reference, core);
  await png(result.generation_reference, '#321');
  await assert.rejects(finish(out, generated), /generation reference changed/);
  await assert.rejects(stat(join(out, 'image.png')), { code: 'ENOENT' });
});

async function assessedFixture(t) {
  const { input, out, directory } = await fixture(t);
  const plan = analysis(scene, [
    { source: 'higher group', importance: 'higher', action: 'retain', depiction: 'planned mark' },
    { source: 'lower group', importance: 'lower', action: 'omit', depiction: '' },
  ]);
  await prepare(input, out, plan, 'medium');
  const generated = join(directory, 'generated.png');
  await png(generated, '#789');
  await finish(out, generated);
  const path = join(out, 'visual-review.json');
  const record = JSON.parse(await readFile(path));
  for (const item of [...Object.values(record.checks), ...record.content_plan.core_information, ...record.content_plan.optional_details]) Object.assign(item, { status: 'pass', evidence: 'Synthetic reviewer fixture; verifies review bookkeeping only.' });
  record.content_plan.optional_details[0].actual_presence = 'present';
  record.content_plan.optional_details[1].actual_presence = 'absent';
  return { out, path, record };
}

test('itemized review measures actual groups and leaves user acceptance pending', async t => {
  const { out, path, record } = await assessedFixture(t);
  await writeFile(path, JSON.stringify(record));
  const source = await readFile(join(out, 'input.png'));
  await png(join(out, 'input.png'), '#456');
  await assert.rejects(review(out), /source or reviewed image changed/);
  await writeFile(join(out, 'input.png'), source);
  const result = await review(out);
  assert.equal(result.status, 'agent_review_pass');
  assert.equal(result.actual_detail_retention.actual_fraction, 0.5);
  assert.equal(result.user_acceptance, 'pending');
});

test('a restored omission fails even when the reviewer marked its check as pass', async t => {
  const { out, path, record } = await assessedFixture(t);
  record.content_plan.optional_details[1].actual_presence = 'present';
  await writeFile(path, JSON.stringify(record));
  const result = await review(out);
  assert.equal(result.status, 'agent_review_fail');
  assert.equal(result.actual_detail_retention.actual_fraction, 1);
  assert.equal(JSON.parse(await readFile(path)).content_plan.optional_details[1].status, 'fail');
});

test('unknown presence, missing checks and changed plan items cannot claim a complete visual pass', async t => {
  const { out, path, record } = await assessedFixture(t);
  const invalid = structuredClone(record);
  delete invalid.checks.wax_crayon_and_paper_texture;
  await writeFile(path, JSON.stringify(invalid));
  await assert.rejects(review(out), /every visual check/);
  const changed = structuredClone(record);
  changed.content_plan.optional_details[1].action = 'retain';
  await writeFile(path, JSON.stringify(changed));
  await assert.rejects(review(out), /original planned items/);
  record.content_plan.optional_details[1].actual_presence = 'uncertain';
  await writeFile(path, JSON.stringify(record));
  await assert.rejects(review(out), /Unknown detail presence/);
  record.content_plan.optional_details[1].status = 'not_run';
  await writeFile(path, JSON.stringify(record));
  const pending = await review(out);
  assert.equal(pending.status, 'awaiting_visual_review');
  assert.equal(pending.actual_detail_retention.actual_fraction, null);
  assert.equal(pending.actual_detail_retention.unknown_group_count, 1);
});
