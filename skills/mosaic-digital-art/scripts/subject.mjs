import { readFile, stat } from 'node:fs/promises';
import sharp from 'sharp';
import { sha256 } from './render.mjs';

async function readImage(path, mask = false) {
  const file = await stat(path);
  if (!file.isFile() || file.size > 25 * 1024 * 1024) throw new Error('Image must be a file of at most 25 MiB');
  const bytes = await readFile(path);
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes.subarray(0, 3).equals(Buffer.from([255,216,255]));
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (mask ? !png : !png && !jpeg && !webp) throw new Error(mask ? 'Subject mask must be PNG' : 'Input must be PNG, JPEG or static WebP');
  const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' });
  const metadata = await image.metadata();
  if ((metadata.pages ?? 1) !== 1) throw new Error('Animated/multipage input is unsupported');
  if (mask && (metadata.orientation ?? 1) !== 1) throw new Error('Subject mask must use displayed orientation');
  return { bytes, image };
}

// Masks are supplied by the Agent or a segmentation tool; this performs exact local extraction.
export async function extractSubject(input, maskPath, width) {
  const source = await readImage(input);
  const { data, info } = await source.image.autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let maskHash = null;
  if (maskPath) {
    const mask = await readImage(maskPath, true);
    const decoded = await mask.image.toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== info.width || decoded.info.height !== info.height) throw new Error('Subject mask must match oriented source dimensions');
    for (let i = 0; i < decoded.data.length; i += 4) {
      const m = decoded.data;
      if (m[i] !== m[i + 1] || m[i] !== m[i + 2] || m[i + 3] !== 255) throw new Error('Subject mask must be opaque grayscale');
      data[i + 3] = Math.round(data[i + 3] * m[i] / 255);
    }
    maskHash = sha256(mask.bytes);
  } else if (!data.some((value, i) => i % 4 === 3 && value === 0)) {
    throw new Error('Opaque input requires --subject-mask; first select and verify the subject');
  }
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    if (data[i + 3] === 0) { data.fill(0, i, i + 3); continue; }
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new Error('Subject mask is empty');
  const crop = { left, top, width: right - left + 1, height: bottom - top + 1 };
  const inner = width - Math.ceil(width * .04) * 2;
  const png = await sharp(data, { raw: info }).extract(crop)
    .resize(inner, inner, { fit: 'contain', background: '#00000000', kernel: 'linear' })
    .extend({ top: (width - inner) / 2, bottom: (width - inner) / 2, left: (width - inner) / 2, right: (width - inner) / 2, background: '#00000000' })
    .png().toBuffer();
  return { png, source: { sha256: sha256(source.bytes), width: info.width, height: info.height, mask_sha256: maskHash, crop },
    policy: 'Mask applied before sampling; subject fitted proportionally to a transparent square with 4% margins.' };
}
