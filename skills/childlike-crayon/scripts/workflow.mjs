import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const VERSION = '0.2.5';
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

export async function prepare(input, out, scene, drawingLevel) {
  if (typeof scene !== 'string' || !scene.trim() || scene.length > 12_000) throw new Error('Scene notes must contain 1–12000 characters');
  if (drawingLevel === undefined) return {
    status: 'awaiting_drawing_level',
    question: '这张图想生成哪档绘画能力的图片？请选择后再生成一张。',
    options: [
      { value: 'medium', label: '中（推荐）：基本特征可辨、细节粗简' },
      { value: 'low', label: '低：细节粗糙、缺失较多' },
      { value: 'high', label: '高：细节较完整准确' },
    ],
  };
  const levels = JSON.parse(await readFile(new URL('../references/drawing-levels.json', import.meta.url), 'utf8'));
  if (typeof drawingLevel !== 'string' || !Object.hasOwn(levels, drawingLevel)) throw new Error('Drawing level must be low, medium or high');
  const source = await readImage(input);
  const { data, info } = await source.decoder.autoOrient().toColourspace('srgb').flatten({ background: PAPER })
    .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const divisor = gcd(source.width, source.height);
  const ratio = `${source.width / divisor}:${source.height / divisor}`;
  const template = await readFile(new URL('../references/prompt-template.txt', import.meta.url), 'utf8');
  const prompt = template.replace('{{RATIO}}', ratio)
    .replace('{{LEVEL_GUIDANCE}}', () => levels[drawingLevel]).replace('{{SCENE}}', () => scene.trim());
  const directory = await reserveOutput(out);
  await writeFile(resolve(directory, 'input.png'), data, { flag: 'wx' });
  await writeFile(resolve(directory, 'scene.txt'), scene.trim() + '\n', { flag: 'wx' });
  await writeFile(resolve(directory, 'prompt.txt'), prompt, { flag: 'wx' });
  const manifest = {
    schema_version: '0.1.0', created_at: new Date().toISOString(),
    skill: { id: 'childlike-crayon', version: VERSION, variant: 'naive-source-colors' },
    drawing_level: drawingLevel,
    generation_policy: { image_count: 1, automatic_retry_limit: 0 },
    source: { sha256: hash(source.bytes), format: source.format, width: source.width, height: source.height },
    input: { file: 'input.png', sha256: hash(data), width: info.width, height: info.height },
    prompt: { file: 'prompt.txt', sha256: hash(prompt) },
    execution: { renderer: 'host-image-edit-tool', provider: null, provider_version: null, seed: null },
    cost: { amount: null, currency: null, evidence: 'Host tool has not reported a cost' },
    outputs: [], status: 'awaiting_generation',
  };
  await writeFile(resolve(directory, 'manifest.json'), json(manifest), { flag: 'wx' });
  return { directory, input: resolve(directory, 'input.png'), prompt: resolve(directory, 'prompt.txt'), drawing_level: drawingLevel, status: manifest.status };
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
  const generated = await readImage(generatedPath);
  const aspectError = Math.abs((generated.width / generated.height) / (manifest.source.width / manifest.source.height) - 1);
  if (aspectError > 0.003) throw new Error('Generated aspect ratio differs from source; report the mismatch and await a user-requested revision');
  const { data, info } = await generated.decoder.autoOrient().toColourspace('srgb').flatten({ background: PAPER })
    .png().toBuffer({ resolveWithObject: true });
  if (info.width === manifest.input.width && info.height === manifest.input.height) {
    const originalPixels = await sharp(input).removeAlpha().raw().toBuffer();
    const outputPixels = await sharp(data).removeAlpha().raw().toBuffer();
    if (originalPixels.equals(outputPixels)) throw new Error('Output is unchanged input; an actual image edit is required');
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
  await writeFile(resolve(directory, 'visual-review.json'), json(review), { flag: 'wx' });
  manifest.outputs = [{ file: 'image.png', sha256: outputHash }];
  manifest.generated_source_sha256 = hash(generated.bytes);
  manifest.status = 'awaiting_visual_review';
  await writeFile(resolve(directory, 'manifest.json'), json(manifest));
  return { directory, image: resolve(directory, 'image.png'), technical_checks: checks.status, status: manifest.status };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      input: { type: 'string' }, out: { type: 'string' }, scene: { type: 'string' },
      run: { type: 'string' }, generated: { type: 'string' },
      'drawing-level': { type: 'string' },
    } });
    let result;
    if (positionals.length === 1 && positionals[0] === 'prepare' && values.input && values.out && values.scene) {
      result = await prepare(values.input, values.out, await readFile(values.scene, 'utf8'), values['drawing-level']);
    } else if (positionals.length === 1 && positionals[0] === 'finish' && values.run && values.generated) {
      result = await finish(values.run, values.generated);
    } else throw new Error('Use prepare --input IMAGE --scene NOTES.txt --out runs/NEW [--drawing-level low|medium|high], or finish --run RUN --generated IMAGE');
    console.log(json(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
