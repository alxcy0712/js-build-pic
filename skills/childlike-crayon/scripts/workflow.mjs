import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { orderedMarks, renderGuide, validateMarks } from './plan-guide.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const VERSION = '0.5.0';
const PAPER = '#faf7ef';
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const ASPECT_TOLERANCE = 0.003;
const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (base, target) => {
  const path = relative(base, target);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
};

async function fileBytes(path, noFollow = false) {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | (noFollow ? constants.O_NOFOLLOW : 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Image or run file must be a file of at most 25 MiB');
    const bytes = await file.readFile();
    if (bytes.length > MAX_BYTES) throw new Error('Image or run file must be at most 25 MiB');
    return bytes;
  } finally { await file.close(); }
}

async function decodeImage(bytes) {
  const format = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  if (!format) throw new Error('Image must be PNG, JPEG or static WebP');
  // PNG decoders can report only the default APNG frame. Inspect actual chunks as well.
  if (format !== 'jpeg') {
    let offset = format === 'png' ? 8 : 12;
    while (offset + 8 <= bytes.length) {
      const length = format === 'png' ? bytes.readUInt32BE(offset) : bytes.readUInt32LE(offset + 4);
      const type = bytes.toString('ascii', offset + (format === 'png' ? 4 : 0), offset + (format === 'png' ? 8 : 4));
      const end = offset + 8 + length + (format === 'png' ? 4 : length % 2);
      if (end > bytes.length) throw new Error('Truncated image chunk');
      if ((format === 'png' && type === 'acTL') || (format === 'webp'
        && (type === 'ANIM' || type === 'ANMF' || (type === 'VP8X' && length > 0 && (bytes[offset + 8] & 2))))) throw new Error('Animated/multipage images are unsupported');
      offset = end;
      if (format === 'png' && type === 'IEND') break;
    }
  }
  const decoder = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning' });
  const metadata = await decoder.metadata();
  if (metadata.format !== format) throw new Error('Decoded image format differs from its file signature');
  if ((metadata.pages ?? 1) !== 1) throw new Error('Animated/multipage images are unsupported');
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)
    || metadata.width <= 0 || metadata.height <= 0 || metadata.width * metadata.height > MAX_PIXELS) throw new Error('Image must contain at most 40 million pixels');
  const swapped = (metadata.orientation ?? 1) >= 5;
  return { bytes, decoder, format: metadata.format,
    width: swapped ? metadata.height : metadata.width,
    height: swapped ? metadata.width : metadata.height };
}

export async function readImage(path) {
  return decodeImage(await fileBytes(path));
}

function outputPath(path) {
  if (!path) throw new Error('An output/run path is required');
  const target = resolve(ROOT, path);
  const base = resolve(ROOT, 'runs');
  if (!inside(base, target) || target === base) throw new Error('Output must be a new subdirectory of this skill’s runs/');
  return { target, base };
}

export async function reserveOutput(path) {
  const { target, base } = outputPath(path);
  await mkdir(base, { recursive: true });
  if (await realpath(base) !== base) throw new Error('Output root must be a real local directory');
  if (await realpath(dirname(target)) !== dirname(target)) throw new Error('Output parent escapes its real local directory');
  await mkdir(target);
  await runFiles(target);
  return target;
}

async function runFiles(path) {
  if (typeof constants.O_NOFOLLOW !== 'number') throw new Error('Host lacks O_NOFOLLOW support required for safe run-file I/O');
  const { target: directory, base } = outputPath(path);
  if (await realpath(base) !== base || await realpath(directory) !== directory) throw new Error('Run escapes its real local directory');
  const identity = await stat(directory);
  if (!identity.isDirectory()) throw new Error('Run must be a directory');
  return { directory, dev: identity.dev, ino: identity.ino };
}

async function assertRun(run) {
  const current = await runFiles(run.directory);
  if (current.dev !== run.dev || current.ino !== run.ino) throw new Error('Run directory changed during the operation');
}

async function readRunFile(run, name) {
  await assertRun(run);
  return fileBytes(resolve(run.directory, name), true);
}

async function writeRunFile(run, name, bytes, replace = false) {
  await assertRun(run);
  const target = resolve(run.directory, name);
  const existing = await lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing && !existing.isFile()) throw new Error('Run files must be regular files: ' + name);
  if (existing && !replace) {
    if ((await readRunFile(run, name)).equals(Buffer.from(bytes))) return;
    throw new Error('Existing run file differs; preserve it and resolve the conflict: ' + name);
  }
  const temporary = resolve(run.directory, `.${name}-${randomUUID()}.tmp`);
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await assertRun(run);
    await file.writeFile(bytes);
    await file.sync();
    await assertRun(run);
    if (replace) {
      const current = await lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (current && !current.isFile()) throw new Error('Run files must be regular files: ' + name);
      // rename replaces the directory entry; a last-moment file symlink is never followed.
      await rename(temporary, target);
    } else {
      // A concurrent existing destination, including a symlink, causes EEXIST.
      await link(temporary, target).catch(async error => {
        if (error.code !== 'EEXIST' || !(await readRunFile(run, name)).equals(Buffer.from(bytes))) throw error;
      });
    }
  } finally {
    await file.close();
    await assertRun(run);
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function requireCurrentRun(manifest) {
  if (manifest.skill?.id !== 'childlike-crayon' || manifest.skill.version !== VERSION) throw new Error(`This workflow requires a ${VERSION} run. Preserve legacy runs and use their original Git version; choose simple or rich explicitly for a new request.`);
}

function contentPlan(analysis) {
  const text = value => typeof value === 'string' && value.trim().length > 0;
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)
    || JSON.stringify(analysis).length > 24_000
    || !['observation', 'grouping_check', 'plan_check'].every(key => text(analysis[key]))
    || !Array.isArray(analysis.core_information) || analysis.core_information.length === 0
    || !Array.isArray(analysis.optional_details)) throw new Error('Analysis requires observation, core information, optional details, grouping check and plan check');
  for (const item of analysis.core_information) {
    if (!item || !['source', 'role', 'depiction'].every(key => text(item[key]))) throw new Error('Core information requires source evidence, role and planned depiction');
    validateMarks(item.guide_marks, true);
  }
  let omitted = false;
  for (const item of analysis.optional_details) {
    if (!item || !text(item.source) || !text(item.importance) || !['retain', 'simplify', 'omit'].includes(item.action)) throw new Error('Optional details require source evidence, importance and a valid action');
    if (item.action === 'omit') {
      omitted = true;
      if (item.depiction !== '') throw new Error('Omitted details must have an empty depiction');
      if (!Array.isArray(item.guide_marks) || item.guide_marks.length) throw new Error('Omitted details must have empty guide marks');
    } else {
      if (omitted) throw new Error('Select optional details in importance order');
      if (!text(item.depiction)) throw new Error('Selected details require a planned depiction');
      validateMarks(item.guide_marks, true);
    }
  }
  const selected = analysis.optional_details.filter(item => item.action !== 'omit');
  orderedMarks(analysis);
  const count = analysis.optional_details.length;
  const imageText = analysis.image_text ?? [];
  if (!Array.isArray(imageText) || imageText.some(item => !item || !text(item.source)
    || !['exact', 'simplify'].includes(item.policy) || typeof item.text !== 'string'
    || (item.policy === 'exact' && !text(item.text)))) throw new Error('Image text requires source evidence, exact/simplify policy and text for exact lettering');
  const scene = [
    'Overall structure and color placement: ' + analysis.observation.trim(),
    'Core information — preserve these planned cues:',
    ...analysis.core_information.map(item => '- ' + item.depiction.trim()),
    'Selected optional details:',
    ...(selected.length ? selected.map(item => '- ' + item.depiction.trim()) : ['Use only the core plan.']),
  ].join('\n');
  if (scene.length > 12_000) throw new Error('Selected content plan must contain at most 12000 characters');
  return { scene, imageText: json(imageText), selection: {
    pool_group_count: count, selected_group_count: selected.length,
    selected_fraction: count ? selected.length / count : null,
    interpretation: 'descriptive_inventory_without_a_quota',
  } };
}

export async function prepare(input, out, analysis, drawingLevel) {
  const levels = JSON.parse(await readFile(new URL('../references/drawing-levels.json', import.meta.url), 'utf8'));
  if (drawingLevel === undefined) return {
    status: 'awaiting_drawing_level',
    question: '这次想要简笔蜡笔，还是丰富蜡笔？',
    explanation: Object.values(levels).map(level => level.label + '：' + level.description).join('；') + '。',
    options: Object.entries(levels).map(([value, level]) => ({ value, label: level.label })),
  };
  if (['low', 'medium', 'high'].includes(drawingLevel)) throw new Error(`Drawing level '${drawingLevel}' was removed in 0.4.0. Ask the user to choose 简笔蜡笔 (simple) or 丰富蜡笔 (rich) for this request; medium has no equivalent and legacy values are not mapped automatically.`);
  if (typeof drawingLevel !== 'string' || !Object.hasOwn(levels, drawingLevel)) throw new Error('Drawing level must be simple or rich, explicitly chosen for this request');
  if (analysis === undefined) return { status: 'awaiting_content_analysis', drawing_level: drawingLevel,
    next: 'Inspect the content image and complete the observation, information roles and detail selection in references/analysis.template.json before preparing generation.' };
  const { scene, imageText, selection } = contentPlan(analysis);
  const analysisBytes = json(analysis);
  const source = await readImage(input);
  const { data, info } = await source.decoder.autoOrient().toColourspace('srgb').flatten({ background: PAPER })
    .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  const core = await renderGuide({ ...analysis, optional_details: [] }, info.width, info.height, PAPER);
  const guide = await renderGuide(analysis, info.width, info.height, PAPER, { drawingLevel });
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const divisor = gcd(source.width, source.height);
  const ratio = `${source.width / divisor}:${source.height / divisor}`;
  const template = await readFile(new URL('../references/prompt-template.txt', import.meta.url), 'utf8');
  const replacements = { RATIO: ratio, LEVEL_GUIDANCE: levels[drawingLevel].guidance, SCENE: scene, IMAGE_TEXT: imageText };
  const prompt = template.replace(/\{\{(RATIO|LEVEL_GUIDANCE|SCENE|IMAGE_TEXT)\}\}/g, (_, key) => replacements[key]);
  const directory = await reserveOutput(out);
  const run = await runFiles(directory);
  for (const [name, bytes] of [['input.png', data], ['core-reference.png', core.bytes], ['plan-reference.png', guide.bytes],
    ['analysis.json', analysisBytes], ['scene.txt', scene + '\n'], ['prompt.txt', prompt]]) await writeRunFile(run, name, bytes);
  const manifest = {
    schema_version: '0.2.0', created_at: new Date().toISOString(),
    skill: { id: 'childlike-crayon', version: VERSION, variant: 'naive-source-colors' },
    drawing_level: drawingLevel,
    content_analysis: { file: 'analysis.json', sha256: hash(analysisBytes) },
    detail_selection: selection,
    generation_policy: { image_count: 1, automatic_retry_limit: 0 },
    source: { sha256: hash(source.bytes), format: source.format, width: source.width, height: source.height },
    input: { file: 'input.png', sha256: hash(data), width: info.width, height: info.height,
      aspect_relative_error: Math.abs((info.width / info.height) / (source.width / source.height) - 1) },
    core_reference: { file: 'core-reference.png', sha256: hash(core.bytes),
      role: 'task_derived_core_only', mark_count: core.mark_count },
    generation_reference: { file: 'plan-reference.png', sha256: hash(guide.bytes),
      role: 'supporting_plan_source_image_is_authoritative', mark_count: guide.mark_count },
    guide_rendering: { core: core.rendering, plan: guide.rendering, order: 'explicit_draw_order_back_to_front' },
    generation_images: ['input.png', 'plan-reference.png'],
    prompt: { file: 'prompt.txt', sha256: hash(prompt) },
    execution: { renderer: 'host-image-edit-tool', provider: null, provider_version: null, seed: null },
    cost: { amount: null, currency: null, evidence: 'Host tool has not reported a cost' },
    outputs: [], status: 'awaiting_generation',
  };
  await writeRunFile(run, 'manifest.json', json(manifest));
  return { directory, input: resolve(directory, 'input.png'), core_reference: resolve(directory, 'core-reference.png'), generation_reference: resolve(directory, 'plan-reference.png'), generation_images: manifest.generation_images.map(name => resolve(directory, name)), prompt: resolve(directory, 'prompt.txt'), drawing_level: drawingLevel, status: manifest.status };
}

export async function finish(runPath, generatedPath, { padToSource } = {}) {
  const run = await runFiles(runPath);
  const { directory } = run;
  const manifest = JSON.parse(await readRunFile(run, 'manifest.json'));
  requireCurrentRun(manifest);
  const completed = ['awaiting_visual_review', 'agent_review_pass', 'agent_review_fail'].includes(manifest.status);
  if (!completed && !['awaiting_generation', 'generated_saved', 'export_failed'].includes(manifest.status)) throw new Error('Run must await generation or export recovery');
  const original = generatedPath ? await fileBytes(generatedPath) : await readRunFile(run, 'generated-original.bin');
  if (manifest.generated_original && hash(original) !== manifest.generated_original.sha256) throw new Error('Generated original differs; preserve this run and prepare a new request for another generation');
  await writeRunFile(run, 'generated-original.bin', original);
  if (!completed) {
    manifest.generated_original = { file: 'generated-original.bin', sha256: hash(original), byte_length: original.length };
    manifest.export_options = { pad_to_source: padToSource ?? manifest.export_options?.pad_to_source ?? false };
    manifest.status = 'generated_saved';
    await writeRunFile(run, 'manifest.json', json(manifest), true);
  }
  try {
    const input = await readRunFile(run, 'input.png');
    const prompt = await readRunFile(run, 'prompt.txt');
    if (hash(input) !== manifest.input.sha256 || hash(prompt) !== manifest.prompt.sha256) throw new Error('Prepared input or prompt changed');
    const guide = await readRunFile(run, 'plan-reference.png');
    if (hash(guide) !== manifest.generation_reference.sha256) throw new Error('Prepared generation reference changed');
    const core = await readRunFile(run, 'core-reference.png');
    if (hash(core) !== manifest.core_reference.sha256) throw new Error('Prepared core reference changed');
    const analysisBytes = await readRunFile(run, 'analysis.json');
    if (hash(analysisBytes) !== manifest.content_analysis.sha256) throw new Error('Prepared content analysis changed');
    const analysis = JSON.parse(analysisBytes);
    if (completed) {
      if (hash(await readRunFile(run, 'image.png')) !== manifest.outputs[0].sha256
        || hash(await readRunFile(run, 'checks.json')) !== manifest.technical_checks.sha256) throw new Error('Completed export changed');
      return { directory, image: resolve(directory, 'image.png'), technical_checks: 'pass', status: manifest.status };
    }
    const generated = await decodeImage(original);
    const ratio = manifest.source.width / manifest.source.height;
    const aspectError = Math.abs((generated.width / generated.height) / ratio - 1);
    Object.assign(manifest.generated_original, { format: generated.format, width: generated.width, height: generated.height, aspect_relative_error: aspectError });
    let { data, info } = await generated.decoder.autoOrient().toColourspace('srgb').flatten({ background: PAPER })
      .png().toBuffer({ resolveWithObject: true });
    if (info.width === manifest.input.width && info.height === manifest.input.height) {
      const outputPixels = await sharp(data).removeAlpha().raw().toBuffer();
      for (const [name, bytes] of [['input', input], ['generation reference', guide], ['core reference', core]]) {
        if ((await sharp(bytes).removeAlpha().raw().toBuffer()).equals(outputPixels)) throw new Error('Output is unchanged ' + name + '; an actual image edit is required');
      }
    }
    let padding = null;
    if (aspectError > ASPECT_TOLERANCE) {
      if (!manifest.export_options.pad_to_source) throw new Error('Generated aspect ratio differs from source; original saved. Explicitly authorize paper padding or request another generation.');
      const width = Math.max(info.width, Math.ceil(info.height * ratio));
      const height = Math.max(info.height, Math.ceil(info.width / ratio));
      if (width * height > MAX_PIXELS) throw new Error('Padded presentation exceeds 40 million pixels; original saved');
      const left = Math.floor((width - info.width) / 2), top = Math.floor((height - info.height) / 2);
      padding = { left, right: width - info.width - left, top, bottom: height - info.height - top };
      ({ data, info } = await sharp(data).extend({ ...padding, background: PAPER }).png().toBuffer({ resolveWithObject: true }));
    }
    const presentationError = Math.abs((info.width / info.height) / ratio - 1);
    if (presentationError > ASPECT_TOLERANCE) throw new Error('Presentation aspect ratio exceeds tolerance after integer rounding; original saved');
    if (data.length > MAX_BYTES) throw new Error('Presentation exceeds 25 MiB; original saved');
    const outputHash = hash(data);
    const checks = {
      status: 'pass', scope: 'file_format_dimensions_and_integrity',
      width: info.width, height: info.height, aspect_relative_error: presentationError,
      aspect_tolerance: ASPECT_TOLERANCE, original_aspect_relative_error: aspectError,
      presentation: { mode: padding ? 'paper_padding' : 'normalized_copy', padding },
      sha256: outputHash, opaque: (await sharp(data).stats()).isOpaque,
      content_preservation: 'not_run', childlike_style: 'not_run',
    };
    const visual = JSON.parse(await readFile(new URL('../references/review.template.json', import.meta.url), 'utf8'));
    visual.drawing_level = manifest.drawing_level;
    visual.detail_selection = manifest.detail_selection;
    visual.content_plan = {
      core_information: analysis.core_information.map(item => ({ ...item, status: 'not_run', evidence: '' })),
      optional_details: analysis.optional_details.map(item => ({ ...item, actual_presence: 'not_run', status: 'not_run', evidence: '' })),
      image_text: (analysis.image_text ?? []).map(item => ({ ...item, status: 'not_run', evidence: '' })),
    };
    // Each artifact is complete before publication. Identical prior artifacts support export-only retries.
    await writeRunFile(run, 'image.png', data);
    await writeRunFile(run, 'checks.json', json(checks));
    await writeRunFile(run, 'visual-review.json', json(visual));
    manifest.outputs = [{ file: 'image.png', sha256: outputHash }];
    manifest.technical_checks = { file: 'checks.json', sha256: hash(json(checks)) };
    manifest.status = 'awaiting_visual_review';
    delete manifest.export_error;
    await writeRunFile(run, 'manifest.json', json(manifest), true);
    return { directory, image: resolve(directory, 'image.png'), original: resolve(directory, 'generated-original.bin'), technical_checks: checks.status, status: manifest.status };
  } catch (error) {
    if (!completed) {
      manifest.status = 'export_failed';
      manifest.export_error = { message: error.message };
      await writeRunFile(run, 'manifest.json', json(manifest), true);
    }
    throw error;
  }
}

export async function review(runPath) {
  const run = await runFiles(runPath);
  const { directory } = run;
  const manifest = JSON.parse(await readRunFile(run, 'manifest.json'));
  requireCurrentRun(manifest);
  if (manifest.status !== 'awaiting_visual_review' || !manifest.content_analysis) throw new Error('Run must await an itemized visual review');
  const analysisBytes = await readRunFile(run, 'analysis.json');
  if (hash(analysisBytes) !== manifest.content_analysis.sha256
    || hash(await readRunFile(run, 'input.png')) !== manifest.input.sha256
    || hash(await readRunFile(run, 'image.png')) !== manifest.outputs[0].sha256
    || hash(await readRunFile(run, 'checks.json')) !== manifest.technical_checks.sha256) throw new Error('Analysis, source, reviewed image or technical checks changed');
  const analysis = JSON.parse(analysisBytes);
  const result = JSON.parse(await readRunFile(run, 'visual-review.json'));
  result.drawing_level = manifest.drawing_level;
  result.detail_selection = manifest.detail_selection;
  const template = JSON.parse(await readFile(new URL('../references/review.template.json', import.meta.url), 'utf8'));
  const valid = item => item && ['pass', 'fail', 'not_run'].includes(item.status)
    && (item.status === 'not_run' || typeof item.evidence === 'string' && item.evidence.trim());
  for (const kind of ['core_information', 'optional_details', 'image_text']) {
    const planned = analysis[kind] ?? [];
    const items = result.content_plan?.[kind];
    if (!Array.isArray(items) || items.length !== planned.length) throw new Error('Review must cover every planned item');
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!valid(item) || Object.entries(planned[index]).some(([key, value]) => JSON.stringify(item[key]) !== JSON.stringify(value))) throw new Error('Review requires original planned items and evidence for each assessed result');
      if (kind === 'optional_details') {
        if (!['present', 'absent', 'uncertain', 'not_run'].includes(item.actual_presence)) throw new Error('Detail review requires actual group presence');
        if (['uncertain', 'not_run'].includes(item.actual_presence)) {
          if (item.status === 'pass') throw new Error('Unknown detail presence cannot pass');
        } else {
          if (typeof item.evidence !== 'string' || !item.evidence.trim()) throw new Error('Measured detail presence requires evidence');
          if ((item.action === 'omit') !== (item.actual_presence === 'absent')) item.status = 'fail';
        }
      }
    }
  }
  for (const key of Object.keys(template.checks)) if (!valid(result.checks?.[key])) throw new Error('Review requires every visual check and evidence for each assessed result');
  const optional = result.content_plan.optional_details;
  const present = optional.filter(item => item.actual_presence === 'present').length;
  const absent = optional.filter(item => item.actual_presence === 'absent').length;
  const unknown = optional.length - present - absent;
  result.actual_detail_retention = { pool_group_count: optional.length, present_group_count: present,
    absent_group_count: absent, unknown_group_count: unknown,
    actual_fraction: optional.length && !unknown ? present / optional.length : null,
    basis: 'itemized_presence_in_the_fixed_optional_group_inventory' };
  const assessed = [...Object.keys(template.checks).map(key => result.checks[key]), ...result.content_plan.core_information, ...optional, ...result.content_plan.image_text];
  result.overall = assessed.some(item => item.status === 'fail') ? 'agent_review_fail'
    : assessed.every(item => item.status === 'pass') && !unknown ? 'agent_review_pass' : 'not_run';
  manifest.status = result.overall === 'not_run' ? 'awaiting_visual_review' : result.overall;
  await writeRunFile(run, 'visual-review.json', json(result), true);
  await writeRunFile(run, 'manifest.json', json(manifest), true);
  return { directory, status: manifest.status, actual_detail_retention: result.actual_detail_retention, user_acceptance: result.user_acceptance };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      input: { type: 'string' }, out: { type: 'string' }, analysis: { type: 'string' },
      run: { type: 'string' }, generated: { type: 'string' },
      'drawing-level': { type: 'string' },
      'pad-to-source': { type: 'boolean' },
    } });
    let result;
    if (positionals.length === 1 && positionals[0] === 'prepare' && values.input && values.out) {
      const analysis = values.analysis && values['drawing-level'] ? JSON.parse(await readFile(values.analysis, 'utf8')) : undefined;
      result = await prepare(values.input, values.out, analysis, values['drawing-level']);
    } else if (positionals.length === 1 && positionals[0] === 'finish' && values.run) {
      result = await finish(values.run, values.generated, { padToSource: values['pad-to-source'] });
    } else if (positionals.length === 1 && positionals[0] === 'review' && values.run) {
      result = await review(values.run);
    } else throw new Error('Use prepare --input IMAGE --analysis ANALYSIS.json --out runs/NEW [--drawing-level simple|rich], finish --run RUN [--generated IMAGE] [--pad-to-source], or review --run RUN');
    console.log(json(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
