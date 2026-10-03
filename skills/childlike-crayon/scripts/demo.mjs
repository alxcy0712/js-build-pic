import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { prepare, ROOT } from './workflow.mjs';

const usage = 'npm run demo -- --input IMAGE --scene NOTES.txt [--drawing-level low|medium|high] [--out runs/NEW]';
try {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, scene: { type: 'string' }, out: { type: 'string' },
    'drawing-level': { type: 'string' },
  } });
  let result;
  if (Object.keys(values).length === 0) {
    result = { status: 'awaiting_input', usage };
  } else {
    if (!values.input || !values.scene) throw new Error(usage);
    result = await prepare(values.input, values.out ?? resolve(ROOT, 'runs', `demo-${Date.now()}`),
      await readFile(values.scene, 'utf8'), values['drawing-level']);
    result.next = result.status === 'awaiting_drawing_level'
      ? 'Ask the user to select a drawing level, wait for their answer, then rerun with --drawing-level.'
      : 'Inspect input.png, call the available image-edit tool once for one image with prompt.txt, then run finish and complete visual-review.json. Report issues and wait for a user-requested revision.';
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
