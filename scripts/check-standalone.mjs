import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { assertContained, checkProject, checkSkill, ignored, root } from './check-structure.mjs';
import { copyDelivery, deliveryFiles } from './delivery-files.mjs';

const run = promisify(execFile);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = { ...process.env };
delete env.NODE_PATH;
delete env.NODE_OPTIONS;
for (const key of Object.keys(env)) if (/^npm_config_/i.test(key)) delete env[key];
const { values } = parseArgs({ options: { include: { type: 'string', multiple: true }, skill: { type: 'string' }, keep: { type: 'boolean', default: false } } });
const files = await deliveryFiles(root, values.include);
const report = { checked_at: new Date().toISOString(), status: 'pass', skills: [] };

await checkProject(root, files);

for (const entry of await readdir(join(root, 'skills'), { withFileTypes: true })) {
  if (!entry.isDirectory() || ignored.has(entry.name)) continue;
  if (values.skill && entry.name !== values.skill) continue;
  const source = join(root, 'skills', entry.name);
  const result = { id: entry.name, status: 'pass' };
  await mkdir(join(source, 'runs'), { recursive: true });
  const reportDirectory = await mkdtemp(join(source, 'runs', 'standalone-'));
  let isolated;
  try {
    console.log(`Checking standalone skill: ${entry.name}`);
    isolated = await realpath(await mkdtemp(join(tmpdir(), 'js-build-pic 独立验证 ')));
    const target = join(isolated, entry.name);
    const prefix = `skills/${entry.name}/`;
    const selected = files.filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length));
    await copyDelivery(source, target, selected);
    const pkg = await checkSkill(target);
    await mkdir(join(target, '.cache'), { recursive: true });
    await writeFile(join(target, '.cache/user.npmrc'), '');
    await writeFile(join(target, '.cache/global.npmrc'), '');
    const isolatedEnv = { ...env, npm_config_userconfig: join(target, '.cache/user.npmrc'), npm_config_globalconfig: join(target, '.cache/global.npmrc') };
    const options = { cwd: target, env: isolatedEnv, maxBuffer: 2 * 1024 * 1024, timeout: 120_000 };
    await run(npm, ['ci', '--ignore-scripts', '--cache', join(target, '.cache/npm'), '--registry', 'https://registry.npmjs.org', '--no-audit', '--no-fund'], options);
    const require = createRequire(join(target, 'package.json'));
    for (const name of Object.keys(pkg.dependencies ?? {})) assertContained(target, require.resolve(name));
    const tests = await run(npm, ['test'], options);
    const demo = await run(npm, ['run', '--silent', 'demo'], options);
    result.version = pkg.version;
    result.delivery_files = selected;
    result.initial_runs = 'absent: the delivery copy contains source files only';
    result.copy = values.keep ? target : null;
    result.tests = tests.stdout.trim();
    result.demo = demo.stdout.trim();
    result.artifact_retention = values.keep ? 'Current-task copy is retained for real generation and visual review; clean it explicitly after preserving the task evidence.' : 'Temporary demo outputs are removed after verification; this report retains the execution results.';
    result.isolation = 'Git file inventory plus explicit --include additions only; path with spaces and Chinese characters; fresh locked dependencies, cache and empty npm config inside copy; external Node paths cleared; dependency resolution remains inside copy; tests cover separate working directories.';
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
    if (isolated && !values.keep) await rm(isolated, { recursive: true, force: true });
    await writeFile(join(reportDirectory, 'report.json'), JSON.stringify({ checked_at: report.checked_at, ...result }, null, 2) + '\n');
    console.log(`Report: ${join(reportDirectory, 'report.json')}`);
    report.skills.push(result);
  }
}
assert.ok(report.skills.length > 0, 'No skill folders found');
