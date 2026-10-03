import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { reserveOutput } from './render.mjs';

// Explicit, normalized polygon selection. This helper performs no semantic segmentation.
export async function createMask(width, height, points) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width * height > 40_000_000) throw new Error('Mask dimensions must contain 1..40000000 pixels');
  if (!Array.isArray(points) || points.length < 3 || points.length > 4096
    || points.some(point => !Array.isArray(point) || point.length !== 2
      || point.some(value => !Number.isFinite(value) || value < 0 || value > 1))) throw new Error('Polygon requires 3..4096 normalized [x,y] points in 0..1');
  const pixels = Buffer.alloc(width * height);
  const polygon = points.map(([x, y]) => [x * width, y * height]);
  for (let y = 0; y < height; y++) {
    const scan = y + 0.5, crossings = [];
    for (let i = 0; i < polygon.length; i++) {
      const [ax, ay] = polygon[i], [bx, by] = polygon[(i + 1) % polygon.length];
      if ((ay > scan) !== (by > scan)) crossings.push(ax + (scan - ay) * (bx - ax) / (by - ay));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const left = Math.max(0, Math.ceil(crossings[i] - 0.5));
      const right = Math.min(width, Math.ceil(crossings[i + 1] - 0.5));
      if (right > left) pixels.fill(255, y * width + left, y * width + right);
    }
  }
  if (!pixels.includes(255)) throw new Error('Polygon must cover at least one mask pixel');
  return sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

async function main() {
  const { values } = parseArgs({ options: {
    width: { type: 'string' }, height: { type: 'string' }, polygon: { type: 'string' }, out: { type: 'string' },
  } });
  if (!values.width || !values.height || !values.polygon || !values.out) throw new Error('--width, --height, --polygon and --out are required');
  const file = await stat(values.polygon);
  if (!file.isFile() || file.size > 256 * 1024) throw new Error('Polygon JSON must be a file of at most 256 KiB');
  const points = JSON.parse(await readFile(values.polygon, 'utf8'));
  const png = await createMask(Number(values.width), Number(values.height), points);
  const directory = await reserveOutput(values.out);
  await writeFile(resolve(directory, 'subject-mask.png'), png, { flag: 'wx' });
  await writeFile(resolve(directory, 'polygon.json'), JSON.stringify(points) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ mask: resolve(directory, 'subject-mask.png'), method: 'explicit_polygon' }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
