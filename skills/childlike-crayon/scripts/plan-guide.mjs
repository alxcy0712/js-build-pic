import sharp from 'sharp';

const color = value => value === 'none' || /^#[\da-f]{6}$/i.test(value ?? '');
const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;

export function validateMarks(marks, required) {
  if (!Array.isArray(marks) || marks.length > 200 || (required && !marks.length)) throw new Error('Guide marks require a bounded array of planned primitives');
  for (const mark of marks) {
    if (!mark || !['rect', 'ellipse', 'polygon', 'line'].includes(mark.type)
      || !color(mark.fill ?? 'none') || !color(mark.stroke ?? 'none')) throw new Error('Guide marks require a supported shape and hex colors');
    if (!Number.isInteger(mark.draw_order) || mark.draw_order < 0 || mark.draw_order > 9999) throw new Error('Guide draw_order must be an integer from 0 to 9999');
    if (mark.stroke && mark.stroke !== 'none' && (!unit(mark.width) || mark.width === 0)) throw new Error('Guide strokes require a normalized positive width');
    if (['rect', 'ellipse'].includes(mark.type)) {
      if (!Array.isArray(mark.box) || mark.box.length !== 4 || !mark.box.every(unit)
        || mark.box[2] === 0 || mark.box[3] === 0 || mark.box[0] + mark.box[2] > 1 || mark.box[1] + mark.box[3] > 1) throw new Error('Guide box must lie inside normalized source coordinates');
    } else if (!Array.isArray(mark.points) || mark.points.length < (mark.type === 'line' ? 2 : 3)
      || mark.points.length > 128 || !mark.points.every(point => Array.isArray(point) && point.length === 2 && point.every(unit))) throw new Error('Guide points must lie inside normalized source coordinates');
    if (mark.type === 'line' ? !mark.stroke || mark.stroke === 'none' : (mark.fill ?? 'none') === 'none' && (mark.stroke ?? 'none') === 'none') throw new Error('Guide primitives must produce visible marks');
  }
}

export const CRAYON_SEED = 20261006;

export function orderedMarks(analysis) {
  const items = [...analysis.core_information, ...analysis.optional_details.filter(item => item.action !== 'omit')];
  for (const item of items) validateMarks(item.guide_marks, true);
  const marks = items.flatMap(item => item.guide_marks);
  if (marks.length > 1000) throw new Error('Content guide must contain at most 1000 marks');
  if (new Set(marks.map(mark => mark.draw_order)).size !== marks.length) throw new Error('Guide draw_order must be unique across core and selected marks');
  return marks.sort((a, b) => a.draw_order - b.draw_order);
}

function geometry(mark, width, height, attributes) {
  if (mark.type === 'rect') {
    const [x, y, w, h] = mark.box;
    return `<rect x="${x * width}" y="${y * height}" width="${w * width}" height="${h * height}" ${attributes}/>`;
  }
  if (mark.type === 'ellipse') {
    const [x, y, w, h] = mark.box;
    return `<ellipse cx="${(x + w / 2) * width}" cy="${(y + h / 2) * height}" rx="${w * width / 2}" ry="${h * height / 2}" ${attributes}/>`;
  }
  const points = mark.points.map(([x, y]) => `${x * width},${y * height}`).join(' ');
  return `<${mark.type === 'line' ? 'polyline' : 'polygon'} points="${points}" ${attributes}/>`;
}

function randomFor(seed, order) {
  let state = (seed ^ Math.imul(order + 1, 0x9e3779b1)) >>> 0 || 1;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function outline(mark, width, height, random) {
  let points;
  if (mark.type === 'rect') {
    const [x, y, w, h] = mark.box;
    points = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  } else if (mark.type === 'ellipse') {
    const [x, y, w, h] = mark.box;
    points = Array.from({ length: 33 }, (_, i) => [x + w / 2 + w / 2 * Math.cos(i * Math.PI / 16), y + h / 2 + h / 2 * Math.sin(i * Math.PI / 16)]);
  } else points = mark.type === 'polygon' ? [...mark.points, mark.points[0]] : mark.points;
  points = points.map(([x, y]) => [x * width, y * height]);
  const strokeWidth = mark.width * Math.min(width, height);
  const parts = [];
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i - 1], [endX, endY] = points[i];
    const dx = endX - x, dy = endY - y, length = Math.hypot(dx, dy);
    const drift = Math.min(strokeWidth * 0.25, length * 0.025) * (random() * 2 - 1);
    // Source vertices and line endpoints stay fixed; only the middle of a stroke bends.
    parts.push(`<path d="M${x},${y} Q${(x + endX) / 2 - (length ? dy / length : 0) * drift},${(y + endY) / 2 + (length ? dx / length : 0) * drift} ${endX},${endY}" fill="none" stroke="${mark.stroke}" stroke-width="${strokeWidth * (0.9 + random() * 0.2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  return parts.join('');
}

function crayonMark(mark, width, height, paper, level, seed) {
  const random = randomFor(seed, mark.draw_order);
  const parts = [];
  if (mark.type !== 'line' && (mark.fill ?? 'none') !== 'none') {
    const xs = mark.points?.map(p => p[0] * width), ys = mark.points?.map(p => p[1] * height);
    const [x, y, w, h] = mark.box ? [mark.box[0] * width, mark.box[1] * height, mark.box[2] * width, mark.box[3] * height]
      : [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    const size = Math.max(0.6, Math.min(w, h) * (level === 'simple' ? 0.075 : 0.055));
    const angle = (random() - 0.5) * 50;
    const padding = Math.min(w, h) * 0.5;
    const rows = Math.min(80, Math.max(1, Math.ceil((h + padding * 2) / (size * 0.78))));
    const clip = `area-${mark.draw_order}`;
    parts.push(`<defs><clipPath id="${clip}">${geometry(mark, width, height, '')}</clipPath></defs>`);
    // Opaque paper beneath the wax prevents rear objects showing through front paper gaps.
    parts.push(geometry(mark, width, height, `fill="${paper}"`));
    parts.push(`<g clip-path="url(#${clip})">${geometry(mark, width, height, `fill="${mark.fill}" opacity="0.8"`)}<g transform="rotate(${angle} ${x + w / 2} ${y + h / 2})">`);
    for (let row = 0; row < rows; row++) {
      const cy = y - padding + (row + 0.5) * (h + padding * 2) / rows;
      const start = row % 2 ? x + w + padding : x - padding, end = row % 2 ? x - padding : x + w + padding;
      const bend = (random() - 0.5) * size;
      parts.push(`<path d="M${start},${cy} Q${x + w / 2},${cy + bend} ${end},${cy + bend / 2}" fill="none" stroke="${mark.fill}" stroke-width="${size * (0.9 + random() * 0.3)}" opacity="${0.65 + random() * 0.3}" stroke-linecap="round"/>`);
      const gapX = x - padding + random() * (w + padding * 2);
      parts.push(`<path d="M${gapX},${cy + bend} l${Math.min(w * 0.06, size * 2) * (0.5 + random())},${bend / 3}" stroke="${paper}" stroke-width="${size * 0.04}" opacity="0.45" stroke-linecap="round"/>`);
      const patchX = x + random() * w;
      parts.push(`<path d="M${patchX},${cy} l${Math.min(w * 0.3, size * 5)},${bend}" stroke="${mark.fill}" stroke-width="${size * 0.6}" opacity="0.25" stroke-linecap="round"/>`);
    }
    parts.push('</g></g>');
  }
  if (mark.stroke && mark.stroke !== 'none') parts.push(outline(mark, width, height, random));
  return parts.join('');
}

export async function renderGuide(analysis, width, height, paper, { drawingLevel, seed = CRAYON_SEED } = {}) {
  const marks = orderedMarks(analysis);
  if (drawingLevel !== undefined && !['simple', 'rich'].includes(drawingLevel)) throw new Error('Crayon guide drawing level must be simple or rich');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Crayon guide seed must be an unsigned 32-bit integer');
  const elements = marks.map(mark => drawingLevel ? crayonMark(mark, width, height, paper, drawingLevel, seed)
    : geometry(mark, width, height, `fill="${mark.type === 'line' ? 'none' : mark.fill ?? 'none'}" stroke="${mark.stroke ?? 'none'}" stroke-width="${(mark.width ?? 0) * Math.min(width, height)}" stroke-linecap="round" stroke-linejoin="round"`));
  // SVG is assembled exclusively from validated numbers, shape names and colors.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${paper}"/>${elements.join('')}</svg>`;
  return { bytes: await sharp(Buffer.from(svg)).png().toBuffer(), mark_count: marks.length,
    rendering: drawingLevel ? { engine: 'crayon-guide-v1', drawing_level: drawingLevel, seed } : { engine: 'flat-structure-v1' } };
}
