import sharp from 'sharp';

const color = value => value === 'none' || /^#[\da-f]{6}$/i.test(value ?? '');
const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;

export function validateMarks(marks, required) {
  if (!Array.isArray(marks) || marks.length > 200 || (required && !marks.length)) throw new Error('Guide marks require a bounded array of planned primitives');
  for (const mark of marks) {
    if (!mark || !['rect', 'ellipse', 'polygon', 'line'].includes(mark.type)
      || !color(mark.fill ?? 'none') || !color(mark.stroke ?? 'none')) throw new Error('Guide marks require a supported shape and hex colors');
    if (mark.stroke && mark.stroke !== 'none' && (!unit(mark.width) || mark.width === 0)) throw new Error('Guide strokes require a normalized positive width');
    if (['rect', 'ellipse'].includes(mark.type)) {
      if (!Array.isArray(mark.box) || mark.box.length !== 4 || !mark.box.every(unit)
        || mark.box[2] === 0 || mark.box[3] === 0 || mark.box[0] + mark.box[2] > 1 || mark.box[1] + mark.box[3] > 1) throw new Error('Guide box must lie inside normalized source coordinates');
    } else if (!Array.isArray(mark.points) || mark.points.length < (mark.type === 'line' ? 2 : 3)
      || mark.points.length > 128 || !mark.points.every(point => Array.isArray(point) && point.length === 2 && point.every(unit))) throw new Error('Guide points must lie inside normalized source coordinates');
    if (mark.type === 'line' ? !mark.stroke || mark.stroke === 'none' : (mark.fill ?? 'none') === 'none' && (mark.stroke ?? 'none') === 'none') throw new Error('Guide primitives must produce visible marks');
  }
}

export async function renderGuide(analysis, width, height, paper) {
  const marks = [...analysis.core_information, ...analysis.optional_details.filter(item => item.action !== 'omit')].flatMap(item => item.guide_marks);
  if (marks.length > 1000) throw new Error('Content guide must contain at most 1000 marks');
  const elements = marks.map(mark => {
    const attributes = `fill="${mark.type === 'line' ? 'none' : mark.fill ?? 'none'}" stroke="${mark.stroke ?? 'none'}" stroke-width="${(mark.width ?? 0) * Math.min(width, height)}" stroke-linecap="round" stroke-linejoin="round"`;
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
  });
  // SVG is assembled exclusively from validated numbers, shape names and colors.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${paper}"/>${elements.join('')}</svg>`;
  return { bytes: await sharp(Buffer.from(svg)).png().toBuffer(), mark_count: marks.length };
}
