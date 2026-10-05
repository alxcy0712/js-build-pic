import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { prepare, ROOT } from './workflow.mjs';

const usage = 'npm run demo -- --input IMAGE --analysis ANALYSIS.json [--drawing-level simple|rich] [--out runs/NEW]';
try {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, analysis: { type: 'string' }, out: { type: 'string' },
    'drawing-level': { type: 'string' },
  } });
  let result;
  if (Object.keys(values).length === 0) {
    result = { status: 'awaiting_input', usage };
  } else {
    if (!values.input) throw new Error(usage);
    const analysis = values.analysis && values['drawing-level'] ? JSON.parse(await readFile(values.analysis, 'utf8')) : undefined;
    result = await prepare(values.input, values.out ?? resolve(ROOT, 'runs', `demo-${Date.now()}`),
      analysis, values['drawing-level']);
    if (result.status === 'awaiting_drawing_level') result.next = 'Ask the user to select a drawing level, wait for their answer, then rerun with --drawing-level.';
    if (result.status === 'awaiting_generation') result.next = 'Compare core-reference.png and plan-reference.png with input.png for core content, proportions, contacts and selected features. Inspect image_text separately. Use generation_images in order (source first, planning aid second) and prompt.txt for one generation. Finish saves the original and exports a presentation copy; review source content, lettering and drawing method before delivery.';
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
