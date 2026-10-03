import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { assertContained, checkProject, checkSkill, ignored, root } from './check-structure.mjs';

const run = promisify(execFile);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = { ...process.env };
delete env.NODE_PATH;
delete env.NODE_OPTIONS;
const report = { checked_at: new Date().toISOString(), status: 'pass', skills: [] };

await checkProject();

for (const entry of await readdir(join(root, 'skills'), { withFileTypes: true })) {
  if (!entry.isDirectory() || ignored.has(entry.name)) continue;
  const source = join(root, 'skills', entry.name);
  const result = { id: entry.name, status: 'pass' };
  await mkdir(join(source, 'runs'), { recursive: true });
  const reportDirectory = await mkdtemp(join(source, 'runs', 'standalone-'));
  let isolated;
  try {
    console.log(`Checking standalone skill: ${entry.name}`);
    isolated = await realpath(await mkdtemp(join(tmpdir(), 'js-build-pic 独立验证 ')));
    const target = join(isolated, entry.name);
    await cp(source, target, { recursive: true, filter: path => !relative(source, path).split(sep).some(part => ignored.has(part)) });
    const pkg = await checkSkill(target);
    const options = { cwd: target, env, maxBuffer: 2 * 1024 * 1024, timeout: 120_000 };
    await run(npm, ['ci', '--ignore-scripts', '--cache', join(target, '.cache/npm'), '--registry', 'https://registry.npmjs.org'], options);
    const require = createRequire(join(target, 'package.json'));
    for (const name of Object.keys(pkg.dependencies ?? {})) assertContained(target, require.resolve(name));
    const tests = await run(npm, ['test'], options);
    const demo = await run(npm, ['run', '--silent', 'demo'], options);
    result.version = pkg.version;
    result.tests = tests.stdout.trim();
    result.demo = demo.stdout.trim();
    result.artifact_retention = 'Temporary demo outputs are removed after verification; this report retains the execution results.';
    result.isolation = 'Copied folder only, under a path with spaces and Chinese characters; fresh locked dependencies and cache inside copy; NODE_PATH and NODE_OPTIONS cleared; dependency resolution remains inside copy; CLI also runs from a separate working directory.';
    if (pkg.config?.demoMode === 'agent-image-edit') {
      result.image_generation = 'not_run: supply task inputs to the demo CLI, then let an Agent call its image-edit tool and finish visual review';
      console.log(`PASS ${entry.name}: install, tests and demo CLI; task input and Agent image generation are separate checks`);
    } else {
      console.log(`PASS ${entry.name}: install, tests and image demo`);
    }
  } catch (error) {
    result.status = 'fail';
    result.error = error.message;
    result.stdout = error.stdout;
    result.stderr = error.stderr;
    report.status = 'fail';
    process.exitCode = 1;
    console.error(`FAIL ${entry.name}: ${error.message}`);
  } finally {
    if (isolated) await rm(isolated, { recursive: true, force: true });
    await writeFile(join(reportDirectory, 'report.json'), JSON.stringify({ checked_at: report.checked_at, ...result }, null, 2) + '\n');
    console.log(`Report: ${join(reportDirectory, 'report.json')}`);
    report.skills.push(result);
  }
}
assert.ok(report.skills.length > 0, 'No skill folders found');
