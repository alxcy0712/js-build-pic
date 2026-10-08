import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepare, reserveOutput } from './workflow.mjs';
import { renderGuide } from './plan-guide.mjs';

// This self-authored scene demonstrates the interface; production accepts the current user's image.
const plan = JSON.parse(await readFile(new URL('../references/example-analysis.json', import.meta.url), 'utf8'));
const directory = await reserveOutput(`runs/example-${Date.now()}`);
const paper = '#faf7ef';
const source = await renderGuide(plan, 900, 600, paper);
await writeFile(resolve(directory, 'source.png'), source.bytes);
const results = {};
for (const level of ['simple', 'rich']) {
  const analysis = structuredClone(plan);
  if (level === 'simple') for (const item of analysis.optional_details.slice(1)) {
    item.action = 'omit'; item.depiction = ''; item.guide_marks = [];
  }
  const result = await prepare(resolve(directory, 'source.png'), resolve(directory, level), analysis, level);
  const flat = await renderGuide(analysis, 900, 600, paper);
  await writeFile(resolve(result.directory, 'flat-reference.png'), flat.bytes);
  results[level] = result;
}
const figures = [['source.png', '自制内容图 · 代码构造'], ['simple/flat-reference.png', '同一几何 · 平涂参考稿'],
  ['simple/plan-reference.png', '简笔 · 蜡笔计划稿'], ['rich/plan-reference.png', '丰富 · 蜡笔计划稿']];
await writeFile(resolve(directory, 'index.html'), `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>儿童蜡笔参考稿示范</title><style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:0 20px;background:#faf7ef;color:#292723}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}figure{margin:0}img{width:100%;display:block}figcaption{padding:10px 0}</style><h1>自制内容图 → 两档参考稿</h1><p>这些图片展示代码的结构与笔触。实际儿童蜡笔成图由 Agent 接着调用宿主图像编辑工具、导出并逐项验收。</p><div class="grid">${figures.map(([file, caption]) => `<figure><img src="${file}" alt="${caption}"><figcaption>${caption}</figcaption></figure>`).join('')}</div><p>查看每档的 input.png、core-reference.png、plan-reference.png 与 manifest.json。绘制顺序来自 draw_order，内容取舍来自 role、importance 与 action。</p></html>`);
console.log(JSON.stringify({ directory, preview: resolve(directory, 'index.html'), modes: results,
  image_generation: 'not_run: the two explicitly named evaluation modes are ready for one host call each' }, null, 2));
