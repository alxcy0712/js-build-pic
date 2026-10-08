import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { CRAYON_SEED, orderedMarks, renderGuide } from '../scripts/plan-guide.mjs';

const paper = '#faf7ef';
const rect = (order, box, fill) => ({ type: 'rect', draw_order: order, box, fill });
const core = marks => ({ guide_marks: marks });
const optional = marks => ({ action: 'retain', guide_marks: marks });
async function pixels(bytes) {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return (x, y) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
}

test('source coverage interleaves core and supporting marks independently of importance', async () => {
  const body = rect(20, [0.2, 0.2, 0.5, 0.6], '#c34b3f');
  const window = rect(40, [0.35, 0.35, 0.15, 0.15], '#244d92');
  const rear = rect(10, [0.1, 0.1, 0.7, 0.7], '#32854e');
  const front = rect(30, [0.2, 0.7, 0.5, 0.15], '#ecc33e');
  const plan = { core_information: [core([window, body])], optional_details: [optional([front, rear])] };
  for (const drawingLevel of [undefined, 'simple', 'rich']) {
    const guide = await renderGuide(plan, 300, 300, paper, { drawingLevel });
    const at = await pixels(guide.bytes);
    assert.ok(at(80, 100)[0] > at(80, 100)[1] + 50, 'rear supporting fill stays behind core');
    assert.ok(at(120, 120)[2] > at(120, 120)[0] + 50, 'visible core opening stays above front supporting fill');
    assert.ok(at(100, 225)[0] > at(100, 225)[2] + 90, 'actual front occlusion remains in front of core');
    const reordered = { core_information: [core([body, window])], optional_details: [optional([rear, front])] };
    assert.deepEqual((await renderGuide(reordered, 300, 300, paper, { drawingLevel })).bytes, guide.bytes);
  }
});

test('explicit order is required, bounded and unique across the complete plan', () => {
  const mark = rect(1, [0.1, 0.1, 0.3, 0.3], '#aa3333');
  for (const draw_order of [undefined, -1, 0.5, 10000, '1']) {
    assert.throws(() => orderedMarks({ core_information: [core([{ ...mark, draw_order }])], optional_details: [] }), /draw_order/);
  }
  assert.throws(() => orderedMarks({ core_information: [core([mark])], optional_details: [optional([mark])] }), /unique/);
});

test('seeded wax varies only painted areas and keeps rear colors out of paper gaps', async () => {
  const plan = { core_information: [core([rect(1, [0.1, 0.1, 0.8, 0.8], '#0000ff'), rect(2, [0.2, 0.2, 0.6, 0.6], '#c34b3f')])], optional_details: [] };
  const options = { drawingLevel: 'rich' };
  const first = await renderGuide(plan, 300, 300, paper, options);
  assert.deepEqual((await renderGuide(plan, 300, 300, paper, options)).bytes, first.bytes);
  assert.notDeepEqual((await renderGuide(plan, 300, 300, paper, { ...options, seed: CRAYON_SEED + 1 })).bytes, first.bytes);
  const at = await pixels(first.bytes), colors = new Set();
  for (let y = 80; y < 220; y += 2) for (let x = 80; x < 220; x += 2) {
    const rgb = at(x, y); colors.add(rgb.join(','));
    assert.ok(rgb[0] > rgb[2], 'wax and paper gaps belong to the front region');
  }
  assert.ok(colors.size > 10, 'fills carry local pressure and paper variation');
  assert.deepEqual(at(10, 10), [250, 247, 239]);
  assert.equal((await sharp(first.bytes).stats()).isOpaque, true);
});

test('small identifying lines keep endpoints, contacts and separated openings', async () => {
  const line = { type: 'line', draw_order: 2, points: [[0.2, 0.5], [0.5, 0.5], [0.5, 0.3]], stroke: '#202020', width: 0.01 };
  const plan = { core_information: [core([rect(1, [0.1, 0.1, 0.8, 0.8], '#c34b3f'), line,
    rect(3, [0.6, 0.3, 0.06, 0.08], paper), rect(4, [0.7, 0.3, 0.06, 0.08], paper)])], optional_details: [] };
  for (const drawingLevel of ['simple', 'rich']) {
    const at = await pixels((await renderGuide(plan, 400, 400, paper, { drawingLevel })).bytes);
    for (const point of [[80, 200], [200, 200], [200, 120]]) assert.ok(at(...point).every(c => c < 70));
    for (const point of [[250, 135], [290, 135]]) assert.ok(at(...point).every((c, i) => Math.abs(c - [250, 247, 239][i]) <= 1));
    assert.ok(at(270, 135)[0] > at(270, 135)[2] + 70);
  }
});
