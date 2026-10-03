import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { PALETTE, backgroundRGBA, hasGlyph, resolveRun, sha256, usesSourceColor, validateScene } from './render.mjs';
import { glyphForCell, structureCheck } from './glyphs.mjs';

export async function verify(scene, png) {
  validateScene(scene);
  const decoded = sharp(png, { limitInputPixels: 4096 * 4096, failOn: 'warning' });
  const metadata = await decoded.metadata();
  if (metadata.format !== 'png' || metadata.width !== scene.width || metadata.height !== scene.height || (metadata.pages ?? 1) !== 1) {
    throw new Error('Export format/dimensions differ from the glyph representation');
  }
  const pixels = await decoded.ensureAlpha().raw().toBuffer();
  const { width, height, columns, rows, pixel_size: size } = scene;
  const bg = backgroundRGBA(scene);
  let litPixels = 0;
  // Inspect each exported pixel against its cell's glyph mask. This intentionally
  // does not call the renderer, so additional layers or postprocessing are detected.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const col = Math.min(columns - 1, Math.floor((x + 0.5) * columns / width));
    const row = Math.min(rows - 1, Math.floor((y + 0.5) * rows / height));
    const cell = scene.cells[row * columns + col];
    const gx = Math.floor((x - Math.floor((col + 0.5) * width / columns - 2.5 * size)) / size);
    const gy = Math.floor((y - Math.floor((row + 0.5) * height / rows - 3.5 * size)) / size);
    const ink = gx >= 0 && gx < 5 && gy >= 0 && gy < 7 && glyphForCell(scene, cell)[gy][gx] === '1' && hasGlyph(scene, cell);
    const alpha = bg[3] === 255 ? 255 : ink ? cell.alpha : 0;
    const offset = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      const foreground = usesSourceColor(scene) ? cell.rgb[channel] : PALETTE[channel] * cell.level / 255;
      const expected = ink ? Math.round(bg[3] === 255 ? foreground * cell.alpha / 255 + bg[channel] * (1 - cell.alpha / 255) : foreground) : bg[channel];
      if (pixels[offset + channel] !== expected) throw new Error(`${structureCheck(scene)}: unexpected pixel at ${x},${y}, channel ${channel}`);
    }
    if (pixels[offset + 3] !== alpha) throw new Error(`${structureCheck(scene)}: unexpected alpha at ${x},${y}`);
    if (ink) litPixels++;
  }
  return {
    status: 'pass', width, height, cells: scene.cells.length,
    character_set: [...new Set(scene.cells.map(cell => cell.char))].sort(),
    charset: scene.charset ?? 'binary', structure_check: structureCheck(scene),
    color_mode: usesSourceColor(scene) ? 'source' : 'green', background_rgba: bg,
    lit_pixels: litPixels, checked_pixels: width * height, unexpected_pixels: 0,
    png_sha256: sha256(png),
    scope: 'All RGBA pixels match the declared character set, glyph weights, visibility and solid/transparent background.',
    visual_review: 'not_run',
  };
}

async function main() {
  const { values } = parseArgs({ options: { run: { type: 'string' } } });
  if (!values.run) throw new Error('--run is required');
  const directory = await resolveRun(values.run);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json')));
    const glyphBytes = await readFile(resolve(directory, 'glyphs.json'));
    const scene = JSON.parse(glyphBytes);
    const report = await verify(scene, await readFile(resolve(directory, 'image.png')));
    const text = await readFile(resolve(directory, 'glyphs.txt'), 'utf8');
    const expectedText = Array.from({ length: scene.rows }, (_, row) => scene.cells.slice(row * scene.columns, (row + 1) * scene.columns)
      .map(cell => hasGlyph(scene, cell) ? cell.char : ' ').join('')).join('\n') + '\n';
    if (text !== expectedText) throw new Error('Text export differs from the glyph representation');
    const expectedPaths = ['glyphs.json', 'glyphs.txt', 'image.png'];
    if (JSON.stringify(manifest.outputs.map(item => item.path).sort()) !== JSON.stringify(expectedPaths)) throw new Error('Unexpected output paths');
    for (const output of manifest.outputs) {
      if (sha256(await readFile(resolve(directory, output.path))) !== output.sha256) throw new Error(`Hash mismatch: ${output.path}`);
    }
    report.glyphs_sha256 = sha256(glyphBytes);
    report.verifier_sha256 = sha256(await readFile(fileURLToPath(import.meta.url)));
    report.checked_at = new Date().toISOString();
    await writeFile(resolve(directory, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
    const check = manifest.checks.find(item => item.name === structureCheck(scene));
    Object.assign(check, { status: 'pass', evidence: 'checks.json' });
    manifest.status = 'structure_passed_pending_visual_review';
    await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    // Invalidate an earlier success when a later verification finds changed artifacts.
    await writeFile(resolve(directory, 'checks.json'), JSON.stringify({ status: 'fail', reason: error.message, checked_at: new Date().toISOString() }, null, 2) + '\n');
    if (Array.isArray(manifest?.checks)) {
      const checkName = manifest.checks.find(item => ['strict_01', 'strict_charset'].includes(item.name))?.name ?? 'strict_01';
      manifest.checks = manifest.checks.filter(item => !['strict_01', 'strict_charset'].includes(item.name));
      manifest.checks.push({ name: checkName, status: 'fail', evidence: 'checks.json' });
      manifest.status = 'verification_failed';
      await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
