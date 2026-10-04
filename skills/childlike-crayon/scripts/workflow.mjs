import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { renderGuide, validateMarks } from './plan-guide.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const VERSION = '0.3.3';
const PAPER = '#faf7ef';
const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (base, target) => {
  const path = relative(base, target);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
};

export async function readImage(path) {
  const file = await stat(path);
  if (!file.isFile() || file.size > 25 * 1024 * 1024) throw new Error('Image must be a file of at most 25 MiB');
  const bytes = await readFile(path);
  const supported = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    || (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP');
  if (!supported) throw new Error('Image must be PNG, JPEG or static WebP');
  const decoder = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' });
  const metadata = await decoder.metadata();
  if ((metadata.pages ?? 1) !== 1) throw new Error('Animated/multipage images are unsupported');
  const swapped = (metadata.orientation ?? 1) >= 5;
  return { bytes, decoder, format: metadata.format,
    width: swapped ? metadata.height : metadata.width,
    height: swapped ? metadata.width : metadata.height };
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
  if (!inside(base, await realpath(dirname(target)))) throw new Error('Output parent escapes its allowed directory');
  await mkdir(target);
  return target;
}

function contentPlan(analysis, drawingLevel, target) {
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
  const count = analysis.optional_details.length;
  const targetCount = drawingLevel === 'low' ? Math.floor(count * target) : Math.round(count * target);
  if (drawingLevel === 'low' ? selected.length > targetCount : selected.length !== targetCount) throw new Error('Selected optional detail count must match the drawing level’s group budget');
  const scene = [
    'Overall structure and color placement: ' + analysis.observation.trim(),
    'Core information — preserve these planned cues:',
    ...analysis.core_information.map(item => '- ' + item.depiction.trim()),
    'Selected optional details:',
    ...(selected.length ? selected.map(item => '- ' + item.depiction.trim()) : ['Use only the core plan.']),
  ].join('\n');
  if (scene.length > 12_000) throw new Error('Selected content plan must contain at most 12000 characters');
  return { scene, budget: {
    pool_group_count: count, selected_group_count: selected.length,
    selected_fraction: count ? selected.length / count : null,
    target_fraction: target, target_group_count: targetCount,
    interpretation: 'optional_group_planning_target',
  } };
}

export async function prepare(input, out, analysis, drawingLevel) {
  if (drawingLevel === undefined) return {
    status: 'awaiting_drawing_level',
    question: '这张图想生成哪档绘画能力的图片？请选择后再生成一张。',
    options: [
      { value: 'medium', label: '中（推荐）：约保留一半可选细节，画法粗简' },
      { value: 'low', label: '低：保留 0–10% 可选细节，画法极简粗拙' },
      { value: 'high', label: '高：约保留八成可选细节，仍有儿童稚拙感' },
    ],
  };
  const levels = JSON.parse(await readFile(new URL('../references/drawing-levels.json', import.meta.url), 'utf8'));
  if (typeof drawingLevel !== 'string' || !Object.hasOwn(levels, drawingLevel)) throw new Error('Drawing level must be low, medium or high');
  if (analysis === undefined) return { status: 'awaiting_content_analysis', drawing_level: drawingLevel,
    next: 'Inspect the content image and complete the observation, information roles and detail selection in references/analysis.template.json before preparing generation.' };
  const { scene, budget } = contentPlan(analysis, drawingLevel, levels[drawingLevel].detail_retention_target);
  const analysisBytes = json(analysis);
  const source = await readImage(input);
  const { data, info } = await source.decoder.autoOrient().toColourspace('srgb').flatten({ background: PAPER })
    .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  const core = await renderGuide({ ...analysis, optional_details: [] }, info.width, info.height, PAPER);
  const guide = await renderGuide(analysis, info.width, info.height, PAPER);
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const divisor = gcd(source.width, source.height);
  const ratio = `${source.width / divisor}:${source.height / divisor}`;
  const template = await readFile(new URL('../references/prompt-template.txt', import.meta.url), 'utf8');
  const prompt = template.replace('{{RATIO}}', ratio)
    .replace('{{LEVEL_GUIDANCE}}', () => levels[drawingLevel].guidance).replace('{{SCENE}}', () => scene);
  const directory = await reserveOutput(out);
  await writeFile(resolve(directory, 'input.png'), data, { flag: 'wx' });
  await writeFile(resolve(directory, 'core-reference.png'), core.bytes, { flag: 'wx' });
  await writeFile(resolve(directory, 'plan-reference.png'), guide.bytes, { flag: 'wx' });
  await writeFile(resolve(directory, 'analysis.json'), analysisBytes, { flag: 'wx' });
  await writeFile(resolve(directory, 'scene.txt'), scene + '\n', { flag: 'wx' });
  await writeFile(resolve(directory, 'prompt.txt'), prompt, { flag: 'wx' });
  const manifest = {
    schema_version: '0.1.0', created_at: new Date().toISOString(),
    skill: { id: 'childlike-crayon', version: VERSION, variant: 'naive-source-colors' },
    drawing_level: drawingLevel,
    content_analysis: { file: 'analysis.json', sha256: hash(analysisBytes) },
    detail_budget: budget,
    generation_policy: { image_count: 1, automatic_retry_limit: 0 },
    source: { sha256: hash(source.bytes), format: source.format, width: source.width, height: source.height },
    input: { file: 'input.png', sha256: hash(data), width: info.width, height: info.height },
    core_reference: { file: 'core-reference.png', sha256: hash(core.bytes),
      role: 'task_derived_core_only', mark_count: core.mark_count },
    generation_reference: { file: 'plan-reference.png', sha256: hash(guide.bytes),
      role: 'task_derived_core_and_selected_details', mark_count: guide.mark_count },
    prompt: { file: 'prompt.txt', sha256: hash(prompt) },
    execution: { renderer: 'host-image-edit-tool', provider: null, provider_version: null, seed: null },
    cost: { amount: null, currency: null, evidence: 'Host tool has not reported a cost' },
    outputs: [], status: 'awaiting_generation',
  };
  await writeFile(resolve(directory, 'manifest.json'), json(manifest), { flag: 'wx' });
  return { directory, input: resolve(directory, 'input.png'), core_reference: resolve(directory, 'core-reference.png'), generation_reference: resolve(directory, 'plan-reference.png'), prompt: resolve(directory, 'prompt.txt'), drawing_level: drawingLevel, status: manifest.status };
}

export async function finish(runPath, generatedPath) {
  const { target, base } = outputPath(runPath);
  const directory = await realpath(target);
  if (!inside(base, directory)) throw new Error('Run escapes its allowed directory');
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  if (manifest.skill?.id !== 'childlike-crayon' || manifest.status !== 'awaiting_generation') throw new Error('Run must be awaiting_generation');
  const input = await readFile(resolve(directory, 'input.png'));
  const prompt = await readFile(resolve(directory, 'prompt.txt'));
  if (hash(input) !== manifest.input.sha256 || hash(prompt) !== manifest.prompt.sha256) throw new Error('Prepared input or prompt changed');
  const guide = manifest.generation_reference && await readFile(resolve(directory, 'plan-reference.png'));
  if (guide && hash(guide) !== manifest.generation_reference.sha256) throw new Error('Prepared generation reference changed');
  const core = manifest.core_reference && await readFile(resolve(directory, 'core-reference.png'));
  if (core && hash(core) !== manifest.core_reference.sha256) throw new Error('Prepared core reference changed');
  let analysis;
  if (manifest.content_analysis) {
    const bytes = await readFile(resolve(directory, 'analysis.json'));
    if (hash(bytes) !== manifest.content_analysis.sha256) throw new Error('Prepared content analysis changed');
    analysis = JSON.parse(bytes);
  }
  const generated = await readImage(generatedPath);
  const aspectError = Math.abs((generated.width / generated.height) / (manifest.source.width / manifest.source.height) - 1);
  if (aspectError > 0.003) throw new Error('Generated aspect ratio differs from source; report the mismatch and await a user-requested revision');
  const { data, info } = await generated.decoder.autoOrient().toColourspace('srgb').flatten({ background: PAPER })
    .png().toBuffer({ resolveWithObject: true });
  if (info.width === manifest.input.width && info.height === manifest.input.height) {
    const originalPixels = await sharp(input).removeAlpha().raw().toBuffer();
    const outputPixels = await sharp(data).removeAlpha().raw().toBuffer();
    if (originalPixels.equals(outputPixels)) throw new Error('Output is unchanged input; an actual image edit is required');
    if (guide && (await sharp(guide).removeAlpha().raw().toBuffer()).equals(outputPixels)) throw new Error('Output is unchanged generation reference; an actual image edit is required');
    if (core && (await sharp(core).removeAlpha().raw().toBuffer()).equals(outputPixels)) throw new Error('Output is unchanged core reference; an actual image edit is required');
  }
  const outputHash = hash(data);
  await writeFile(resolve(directory, 'image.png'), data, { flag: 'wx' });
  const checks = {
    status: 'pass', scope: 'file_format_dimensions_and_integrity',
    width: info.width, height: info.height, aspect_relative_error: aspectError,
    sha256: outputHash, opaque: (await sharp(data).stats()).isOpaque,
    content_preservation: 'not_run', childlike_style: 'not_run',
  };
  await writeFile(resolve(directory, 'checks.json'), json(checks), { flag: 'wx' });
  const review = JSON.parse(await readFile(new URL('../references/review.template.json', import.meta.url), 'utf8'));
  review.drawing_level = manifest.drawing_level ?? null;
  review.detail_budget = manifest.detail_budget ?? null;
  if (analysis) review.content_plan = {
    core_information: analysis.core_information.map(item => ({ ...item, status: 'not_run', evidence: '' })),
    optional_details: analysis.optional_details.map(item => ({ ...item, actual_presence: 'not_run', status: 'not_run', evidence: '' })),
  };
  await writeFile(resolve(directory, 'visual-review.json'), json(review), { flag: 'wx' });
  manifest.outputs = [{ file: 'image.png', sha256: outputHash }];
  manifest.generated_source_sha256 = hash(generated.bytes);
  manifest.status = 'awaiting_visual_review';
  await writeFile(resolve(directory, 'manifest.json'), json(manifest));
  return { directory, image: resolve(directory, 'image.png'), technical_checks: checks.status, status: manifest.status };
}

export async function review(runPath) {
  const { target, base } = outputPath(runPath);
  const directory = await realpath(target);
  if (!inside(base, directory)) throw new Error('Run escapes its allowed directory');
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  if (manifest.status !== 'awaiting_visual_review' || !manifest.content_analysis) throw new Error('Run must await an itemized visual review');
  const analysisBytes = await readFile(resolve(directory, 'analysis.json'));
  if (hash(analysisBytes) !== manifest.content_analysis.sha256
    || hash(await readFile(resolve(directory, 'input.png'))) !== manifest.input.sha256
    || hash(await readFile(resolve(directory, 'image.png'))) !== manifest.outputs[0].sha256) throw new Error('Analysis, source or reviewed image changed');
  const analysis = JSON.parse(analysisBytes);
  const result = JSON.parse(await readFile(resolve(directory, 'visual-review.json'), 'utf8'));
  result.drawing_level = manifest.drawing_level;
  result.detail_budget = manifest.detail_budget;
  const template = JSON.parse(await readFile(new URL('../references/review.template.json', import.meta.url), 'utf8'));
  const valid = item => item && ['pass', 'fail', 'not_run'].includes(item.status)
    && (item.status === 'not_run' || typeof item.evidence === 'string' && item.evidence.trim());
  for (const kind of ['core_information', 'optional_details']) {
    const items = result.content_plan?.[kind];
    if (!Array.isArray(items) || items.length !== analysis[kind].length) throw new Error('Review must cover every planned item');
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!valid(item) || Object.entries(analysis[kind][index]).some(([key, value]) => JSON.stringify(item[key]) !== JSON.stringify(value))) throw new Error('Review requires original planned items and evidence for each assessed result');
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
  const assessed = [...Object.keys(template.checks).map(key => result.checks[key]), ...result.content_plan.core_information, ...optional];
  result.overall = assessed.some(item => item.status === 'fail') ? 'agent_review_fail'
    : assessed.every(item => item.status === 'pass') && !unknown ? 'agent_review_pass' : 'not_run';
  manifest.status = result.overall === 'not_run' ? 'awaiting_visual_review' : result.overall;
  await writeFile(resolve(directory, 'visual-review.json'), json(result));
  await writeFile(resolve(directory, 'manifest.json'), json(manifest));
  return { directory, status: manifest.status, actual_detail_retention: result.actual_detail_retention, user_acceptance: result.user_acceptance };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      input: { type: 'string' }, out: { type: 'string' }, analysis: { type: 'string' },
      run: { type: 'string' }, generated: { type: 'string' },
      'drawing-level': { type: 'string' },
    } });
    let result;
    if (positionals.length === 1 && positionals[0] === 'prepare' && values.input && values.out) {
      const analysis = values.analysis && values['drawing-level'] ? JSON.parse(await readFile(values.analysis, 'utf8')) : undefined;
      result = await prepare(values.input, values.out, analysis, values['drawing-level']);
    } else if (positionals.length === 1 && positionals[0] === 'finish' && values.run && values.generated) {
      result = await finish(values.run, values.generated);
    } else if (positionals.length === 1 && positionals[0] === 'review' && values.run) {
      result = await review(values.run);
    } else throw new Error('Use prepare --input IMAGE --analysis ANALYSIS.json --out runs/NEW [--drawing-level low|medium|high], finish --run RUN --generated IMAGE, or review --run RUN');
    console.log(json(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
