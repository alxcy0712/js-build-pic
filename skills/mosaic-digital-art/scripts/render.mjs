import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { CHARSETS, FONT, MIXED_FONT, glyphForCell, structureCheck } from './glyphs.mjs';
export { FONT, GLYPHS } from './glyphs.mjs';

export const VERSION = '0.7.2';
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const STYLE = 'mosaic-digital-art';
export const PALETTE = Object.freeze([40, 255, 126]);
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in ${min}..${max}`);
  }
}

// Separate spatial hash keeps background selection independent of the character set.
export function cellVisible(index, seed, subject, density) {
  let value = (index ^ seed) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
  value = (value ^ (value >>> 16)) >>> 0;
  return subject >= 128 || value / 0x100000000 < density + (1 - density) * subject / 255;
}

async function sampleSubjectMask(path, width, height, columns, rows) {
  const file = await stat(path);
  if (!file.isFile() || file.size > MAX_BYTES) throw new Error('Subject mask must be a PNG of at most 25 MiB');
  const bytes = await readFile(path);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Subject mask must be PNG');
  const decoder = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning' });
  const metadata = await decoder.metadata();
  if ((metadata.pages ?? 1) !== 1 || (metadata.orientation ?? 1) !== 1
    || metadata.width !== width || metadata.height !== height) throw new Error('Subject mask must match oriented source dimensions');
  const { data, info } = await decoder.toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== data[i + 1] || data[i] !== data[i + 2] || data[i + 3] !== 255) throw new Error('Subject mask must be opaque grayscale: white subject, black background');
  }
  const samples = await sharp(data, { raw: info }).removeAlpha().greyscale()
    .resize(columns, rows, { fit: 'fill', kernel: 'linear' }).raw().toBuffer();
  return { samples, source: { sha256: sha256(bytes), width, height } };
}

export async function createScene(input, {
  width = 1536, columns = 128, seed = 42, colorMode = 'source',
  gamma = colorMode === 'green' ? 0.8 : 1, background = colorMode === 'green' ? 'black' : 'source',
  charset = 'binary', subjectMask, backgroundDensity = 0.25,
} = {}) {
  integer(width, 96, 4096, 'width');
  integer(columns, 8, 256, 'columns');
  integer(seed, 0, 0xffffffff, 'seed');
  if (!Number.isFinite(gamma) || gamma < 0.25 || gamma > 2) throw new Error('gamma must be in 0.25..2');
  if (!['source', 'green'].includes(colorMode)) throw new Error('color mode must be source or green');
  if (!Object.hasOwn(CHARSETS, charset)) throw new Error('charset must be binary or mixed');
  if (!Number.isFinite(backgroundDensity) || backgroundDensity < 0 || backgroundDensity > 1) throw new Error('background density must be in 0..1');
  if (colorMode === 'source' && gamma !== 1) throw new Error('Source colour requires gamma 1 to preserve sampled RGB');
  if (!['source', 'black', 'transparent'].includes(background)) throw new Error('background must be source, black or transparent');
  if (width < columns * 6) throw new Error('width must allow at least 6 pixels per column');

  const file = await stat(input);
  if (!file.isFile() || file.size > MAX_BYTES) throw new Error('Input must be a file of at most 25 MiB');
  const bytes = await readFile(input);
  // Reject active/vector formats before passing content to the image decoder.
  const supported = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    || (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP');
  if (!supported) throw new Error('Input must be PNG, JPEG or static WebP');
  const decoder = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning' });
  const metadata = await decoder.metadata();
  if ((metadata.pages ?? 1) !== 1) throw new Error('Animated/multipage images are unsupported');
  const swapAxes = (metadata.orientation ?? 1) >= 5;
  const sourceWidth = swapAxes ? metadata.height : metadata.width;
  const sourceHeight = swapAxes ? metadata.width : metadata.height;
  const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
  integer(height, 8, 4096, 'derived height');
  const rows = Math.max(1, Math.round(height / (width / columns) * 0.75));
  const pixelSize = Math.floor(Math.min(width / columns / 6, height / rows / 8));
  if (pixelSize < 1) throw new Error('Grid is too dense for legible 5x7 glyphs');
  const mask = subjectMask ? await sampleSubjectMask(subjectMask, sourceWidth, sourceHeight, columns, rows) : null;
  const extended = charset !== 'binary' || mask !== null;
  let sampler = decoder;
  if (colorMode === 'source') {
    // Normalize ICC and EXIF first. Float linear-light sampling then avoids
    // 8-bit premultiply rounding without reinterpreting an embedded profile.
    const normalized = await decoder.autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    sampler = sharp(normalized.data, { raw: normalized.info }).pipelineColourspace('scrgb');
  }
  const { data } = await sampler.autoOrient().toColourspace('srgb').ensureAlpha()
    .resize(columns, rows, { fit: 'fill', kernel: colorMode === 'source' ? 'linear' : 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });

  let state = seed >>> 0;
  const cells = [];
  for (let i = 0; i < columns * rows; i++) {
    // LCG, taking the high bit so neighbouring digits do not simply alternate.
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const luminance = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
    cells.push({
      char: charset === 'binary' ? String(state >>> 31) : CHARSETS.mixed[Math.floor(state / 0x100000000 * CHARSETS.mixed.length)],
      level: luminance < 0.012 ? 0 : Math.round(255 * luminance ** gamma),
      ...(colorMode === 'source' ? { rgb: Array.from(data.subarray(i * 4, i * 4 + 3)) } : {}),
      alpha: data[i * 4 + 3],
      ...(extended ? {
        subject: mask ? mask.samples[i] : 0,
        visible: mask ? cellVisible(i, seed, mask.samples[i], backgroundDensity) : true,
        weight: mask && mask.samples[i] >= 128 ? 'bold' : 'regular',
      } : {}),
    });
  }
  let backgroundRgba = [0, 0, 0, background === 'transparent' ? 0 : 255];
  if (background === 'source') {
    if (cells.some(cell => cell.alpha < 255)) {
      backgroundRgba = [0, 0, 0, 0];
    } else {
      const border = cells.map((_, i) => i).filter(i => i < columns || i >= (rows - 1) * columns || i % columns === 0 || i % columns === columns - 1);
      // One flat canvas colour, selected from the sampled edge; all details stay in glyphs.
      backgroundRgba = [0, 1, 2].map(channel => {
        const values = border.map(i => data[i * 4 + channel]).sort((a, b) => a - b);
        return values[Math.floor(values.length / 2)];
      }).concat(255);
    }
  }
  return {
    schema_version: extended ? 3 : 2, style: STYLE,
    variant: mask ? 'subject-focus' : colorMode === 'source' ? 'source-color-grid' : 'luminance-grid',
    font: charset === 'mixed' ? MIXED_FONT : FONT,
    ...(extended ? { charset, focus: mask ? { mask: mask.source, background_density: backgroundDensity } : null } : {}),
    width, height, columns, rows, pixel_size: pixelSize, color_mode: colorMode,
    palette: colorMode === 'source' ? 'source' : [...PALETTE], background, background_rgba: backgroundRgba, seed, gamma,
    source: {
      sha256: sha256(bytes), format: metadata.format, width: metadata.width, height: metadata.height,
      orientation: metadata.orientation ?? 1, oriented_width: sourceWidth, oriented_height: sourceHeight,
    },
    cells,
  };
}

export const usesSourceColor = scene => scene.schema_version >= 2 && scene.color_mode === 'source';
export const hasGlyph = (scene, cell) => cell.alpha > 0 && cell.visible !== false && (usesSourceColor(scene) || cell.level > 0);
export const backgroundRGBA = scene => scene.schema_version === 1
  ? [0, 0, 0, scene.background === 'black' ? 255 : 0] : scene.background_rgba;

export function validateScene(scene) {
  const extended = scene.schema_version === 3;
  const charset = extended ? scene.charset : 'binary';
  if (!Object.hasOwn(CHARSETS, charset)) throw new Error('Unsupported character set');
  const expectedVariant = extended && scene.focus ? 'subject-focus' : usesSourceColor(scene) ? 'source-color-grid' : 'luminance-grid';
  if (![1, 2, 3].includes(scene.schema_version) || scene.font !== (charset === 'mixed' ? MIXED_FONT : FONT)
    || scene.style !== STYLE || scene.variant !== expectedVariant) throw new Error('Unsupported glyph representation');
  if (scene.schema_version >= 2 && !['source', 'green'].includes(scene.color_mode)) throw new Error('Unsupported colour mode');
  if (!extended && (scene.charset !== undefined || scene.focus !== undefined)) throw new Error('Extended fields require schema 3');
  integer(scene.seed, 0, 0xffffffff, 'seed');
  if (extended && scene.focus !== null) {
    const density = scene.focus?.background_density;
    if (!Number.isFinite(density) || density < 0 || density > 1 || !/^[a-f0-9]{64}$/.test(scene.focus?.mask?.sha256 ?? '')) throw new Error('Invalid subject focus metadata');
  }
  integer(scene.width, 96, 4096, 'width');
  integer(scene.height, 8, 4096, 'height');
  integer(scene.columns, 8, 256, 'columns');
  integer(scene.rows, 1, 1024, 'rows');
  integer(scene.pixel_size, 1, 85, 'pixel_size');
  if (scene.pixel_size * 6 > scene.width / scene.columns || scene.pixel_size * 8 > scene.height / scene.rows) {
    throw new Error('Glyphs overlap cell boundaries');
  }
  const expectedPalette = usesSourceColor(scene) ? 'source' : PALETTE;
  if (!(scene.schema_version === 1 ? ['black', 'transparent'] : ['source', 'black', 'transparent']).includes(scene.background)
    || JSON.stringify(scene.palette) !== JSON.stringify(expectedPalette)) {
    throw new Error('Unsupported background or palette');
  }
  const bg = backgroundRGBA(scene);
  if (!Array.isArray(bg) || bg.length !== 4 || ![0, 255].includes(bg[3])) throw new Error('Background must be solid or transparent');
  bg.forEach(channel => integer(channel, 0, 255, 'background channel'));
  if ((scene.background === 'black' && JSON.stringify(bg) !== '[0,0,0,255]')
    || ((scene.background === 'transparent' || bg[3] === 0) && JSON.stringify(bg) !== '[0,0,0,0]')) throw new Error('Background does not match its policy');
  if (!Array.isArray(scene.cells) || scene.cells.length !== scene.columns * scene.rows) throw new Error('Invalid cell count');
  for (const [index, cell] of scene.cells.entries()) {
    if (typeof cell.char !== 'string' || cell.char.length !== 1 || !CHARSETS[charset].includes(cell.char)) throw new Error(`${structureCheck(scene)}: character outside the declared set`);
    if (extended) {
      integer(cell.subject, 0, 255, 'subject coverage');
      const visible = scene.focus ? cellVisible(index, scene.seed, cell.subject, scene.focus.background_density) : true;
      const weight = scene.focus && cell.subject >= 128 ? 'bold' : 'regular';
      if (cell.visible !== visible || cell.weight !== weight || (!scene.focus && cell.subject !== 0)) throw new Error('Cell differs from declared subject focus');
    } else if (cell.visible !== undefined || cell.weight !== undefined || cell.subject !== undefined) throw new Error('Extended cells require schema 3');
    integer(cell.level, 0, 255, 'level');
    integer(cell.alpha, 0, 255, 'alpha');
    if (usesSourceColor(scene)) {
      if (!Array.isArray(cell.rgb) || cell.rgb.length !== 3) throw new Error('Each source-colour glyph requires RGB');
      cell.rgb.forEach(channel => integer(channel, 0, 255, 'RGB channel'));
    }
  }
}

export function rasterize(scene) {
  validateScene(scene);
  const { width, height, columns, rows, pixel_size: size, cells } = scene;
  const bg = backgroundRGBA(scene);
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(bg, i);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!hasGlyph(scene, cell)) continue;
    const x0 = Math.floor(((i % columns) + 0.5) * width / columns - 2.5 * size);
    const y0 = Math.floor((Math.floor(i / columns) + 0.5) * height / rows - 3.5 * size);
    const foreground = usesSourceColor(scene) ? cell.rgb : PALETTE.map(channel => channel * cell.level / 255);
    const color = foreground.map((channel, i) => Math.round(bg[3] === 255 ? channel * cell.alpha / 255 + bg[i] * (1 - cell.alpha / 255) : channel));
    const glyph = glyphForCell(scene, cell);
    for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
      if (glyph[gy][gx] !== '1') continue;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
        const offset = ((y0 + gy * size + dy) * width + x0 + gx * size + dx) * 4;
        pixels.set([...color, bg[3] === 255 ? 255 : cell.alpha], offset);
      }
    }
  }
  return pixels;
}

export async function encode(scene) {
  return sharp(rasterize(scene), { raw: { width: scene.width, height: scene.height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
}

function runPath(directory) {
  const target = resolve(ROOT, directory);
  const rel = relative(ROOT, target);
  if (isAbsolute(rel) || !/^runs\//.test(rel) || rel.split('/').some(part => part === '..')) {
    throw new Error('Output must be a directory inside runs/ of this skill');
  }
  return target;
}

export async function resolveRun(directory) {
  return runPath(await realpath(runPath(directory)));
}

export async function reserveOutput(directory) {
  const target = runPath(directory);
  const root = resolve(ROOT, 'runs');
  await mkdir(root, { recursive: true });
  if (await realpath(root) !== root) throw new Error('Output root must be a real local directory');
  const parent = await realpath(dirname(target));
  if (parent !== root && !parent.startsWith(root + '/')) throw new Error('Output parent escapes its local root');
  await mkdir(target); // Exclusive directory creation preserves earlier runs and symlinks.
  return target;
}

export async function main() {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, out: { type: 'string' }, width: { type: 'string', default: '1536' },
    columns: { type: 'string', default: '128' }, seed: { type: 'string', default: '42' },
    'color-mode': { type: 'string', default: 'source' }, gamma: { type: 'string' }, background: { type: 'string' },
    charset: { type: 'string', default: 'binary' }, 'subject-mask': { type: 'string' }, 'background-density': { type: 'string' },
    help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('npm run render -- --input <local-image> --out runs/<new-id> [--width 1536 --columns 128 --seed 42 --color-mode source|green --background source|black|transparent --charset binary|mixed --subject-mask <opaque-gray.png> --background-density 0.25 --gamma <green-mode exponent>]');
    return;
  }
  if (!values.input || !values.out) throw new Error('--input and --out are required');
  if (values['background-density'] !== undefined && !values['subject-mask']) throw new Error('--background-density requires --subject-mask');
  const started = performance.now();
  const scene = await createScene(values.input, {
    width: Number(values.width), columns: Number(values.columns), seed: Number(values.seed),
    colorMode: values['color-mode'], gamma: values.gamma === undefined ? undefined : Number(values.gamma), background: values.background,
    charset: values.charset, subjectMask: values['subject-mask'],
    backgroundDensity: values['background-density'] === undefined ? 0.25 : Number(values['background-density']),
  });
  const png = await encode(scene);
  const directory = await reserveOutput(values.out);
  const glyphBytes = Buffer.from(JSON.stringify(scene) + '\n');
  const text = Array.from({ length: scene.rows }, (_, row) => scene.cells.slice(row * scene.columns, (row + 1) * scene.columns)
    .map(cell => hasGlyph(scene, cell) ? cell.char : ' ').join('')).join('\n') + '\n';
  await writeFile(resolve(directory, 'image.png'), png, { flag: 'wx' });
  await writeFile(resolve(directory, 'glyphs.json'), glyphBytes, { flag: 'wx' });
  await writeFile(resolve(directory, 'glyphs.txt'), text, { flag: 'wx' });
  const manifest = JSON.parse(await readFile(new URL('../references/run-manifest.template.json', import.meta.url)));
  Object.assign(manifest, {
    task_id: relative(ROOT, directory), created_at: new Date().toISOString(),
    input_refs_or_hashes: [{ sha256: scene.source.sha256 }], style_spec_ref: null,
    skill: { id: scene.style, version: VERSION, variant_id: scene.variant, variant_version: VERSION },
    execution: {
      renderer: 'local-node-sharp', provider: null, provider_version: null,
      code_revision: { renderer_sha256: sha256(await readFile(fileURLToPath(import.meta.url))), font_sha256: sha256(await readFile(new URL('./glyphs.mjs', import.meta.url))) },
      environment: { node: process.version, platform: process.platform, arch: process.arch, versions: sharp.versions },
      font_identifier: scene.font, seed: scene.seed, elapsed_ms: Math.round(performance.now() - started),
    },
    loaded_files: [relative(ROOT, fileURLToPath(import.meta.url)), relative(ROOT, fileURLToPath(new URL('./glyphs.mjs', import.meta.url)))],
    outputs: [{ path: 'image.png', sha256: sha256(png) }, { path: 'glyphs.json', sha256: sha256(glyphBytes) }, { path: 'glyphs.txt', sha256: sha256(text) }],
    checks: [{ name: structureCheck(scene), status: 'not_run' }, { name: 'visual_review', status: 'not_run' }],
    cost: { amount: 0, currency: 'USD', evidence: 'Local rendering; no paid API calls. Local resource costs excluded.' },
    feedback_scope: 'current_image', status: 'rendered_pending_checks',
  });
  if (scene.focus) manifest.input_refs_or_hashes.push({ role: 'subject_mask', sha256: scene.focus.mask.sha256 });
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ directory, width: scene.width, height: scene.height, cells: scene.cells.length, elapsed_ms: manifest.execution.elapsed_ms }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
