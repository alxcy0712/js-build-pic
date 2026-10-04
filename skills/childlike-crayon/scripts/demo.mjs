import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { prepare, ROOT } from './workflow.mjs';

const usage = 'npm run demo -- --input IMAGE --analysis ANALYSIS.json [--drawing-level low|medium|high] [--out runs/NEW]';
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
    if (result.status === 'awaiting_generation') result.next = 'Compare core-reference.png directly with input.png for minimum internal and external structure; then check analysis.json, scene.txt and plan-reference.png. Use plan-reference.png as the sole image-tool reference and prompt.txt for one generation. Run finish, review source structure and every planned item, then run review. Report deviations and wait for a user-requested revision.';
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
