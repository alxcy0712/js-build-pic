import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkProject, checkSkill } from './check-structure.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'skill-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skill = join(root, 'skills/example');
  await mkdir(join(skill, 'scripts'), { recursive: true });
  await mkdir(join(skill, 'references'));
  await mkdir(join(root, 'styles'));
  const pkg = { name: 'example', version: '1.0.0', scripts: { test: 'node --test', demo: 'node scripts/demo.mjs' } };
  const style = { id: 'example', name: 'Example', description: 'Example skill', status: 'draft', version: '1.0.0',
    entrypoint: 'skills/example/SKILL.md', requirements_ref: 'skills/example/references/requirements.md' };
  const write = (path, text) => writeFile(join(root, path), typeof text === 'string' ? text : JSON.stringify(text));
  await write('styles/index.json', { styles: [style] });
  await write('skills/example/package.json', pkg);
  await write('skills/example/package-lock.json', { packages: { '': pkg } });
  await write('skills/example/SKILL.md', '---\nname: example\nmetadata:\n  version: "1.0.0"\n---\n[Rules](references/requirements.md)\n');
  await write('skills/example/references/requirements.md', '[Entry](../SKILL.md)\n');
  await write('skills/example/scripts/demo.mjs', "import { readFile } from 'node:fs/promises';\nawait readFile(new URL('../references/requirements.md', import.meta.url));\n");
  return { root, skill, write, pkg, style };
}

test('a complete skill passes with internal references and ignored private run history', async t => {
  const { root, skill, write } = await fixture(t);
  await mkdir(join(skill, 'runs'));
  await write('skills/example/runs/old-prompt.txt', 'Historical external path /Users/old/task');
  await checkSkill(skill);
  await checkProject(root);
});

test('links and prompts reject outside references and missing local files', async t => {
  const { skill, write } = await fixture(t);
  await write('outside.md', 'outside');
  for (const [content, error] of [
    ['[external](../../../outside.md)', /escapes folder/],
    ['[reference][external]\n[external]: ../../../outside.md', /escapes folder/],
    ['[missing](missing.md)', /ENOENT/],
    ['Load `../../../outside.md` before generating.', /escapes folder/],
    ['Read shared/templates/prompt.txt.', /Project path/],
    ['Read /Users/someone/prompt.txt.', /Machine-specific path/],
    ['[old run](../runs/prompt.txt)', /generated files/],
  ]) {
    await write('skills/example/references/requirements.md', content);
    await assert.rejects(checkSkill(skill), error);
  }
  await write('skills/example/references/requirements.md', 'Local rules');
  for (const path of ['prompt.txt', 'config.json']) {
    await write(`skills/example/references/${path}`, path.endsWith('.json') ? { prompt: '../../../outside.md' } : '../../../outside.md');
    await assert.rejects(checkSkill(skill), /escapes folder/);
    await rm(join(skill, 'references', path));
  }
});

test('imports, package scripts and symbolic links obey the skill boundary', async t => {
  const { root, skill, write, pkg } = await fixture(t);
  for (const content of [
    "import '../../../outside.mjs';",
    "await import('../../../outside.mjs');",
    "new URL('../../../outside.mjs', import.meta.url);",
  ]) {
    await write('skills/example/scripts/demo.mjs', content);
    await assert.rejects(checkSkill(skill), /escapes folder/);
  }
  await write('skills/example/scripts/demo.mjs', "import unlisted from 'unlisted';");
  await assert.rejects(checkSkill(skill), /Undeclared dependency/);
  await write('skills/example/scripts/demo.mjs', '');
  await write('skills/example/package.json', { ...pkg, scripts: { ...pkg.scripts, demo: 'node ../../outside.mjs' } });
  await assert.rejects(checkSkill(skill), /escapes folder/);
  await write('skills/example/package.json', pkg);
  await write('outside.md', 'outside');
  await symlink(join(root, 'outside.md'), join(skill, 'references/linked.md'));
  await assert.rejects(checkSkill(skill), /symlink/);
});

test('local and linked dependencies fail before installation', async t => {
  const { skill, write, pkg } = await fixture(t);
  await write('skills/example/package.json', { ...pkg, dependencies: { sibling: 'file:../sibling' } });
  await assert.rejects(checkSkill(skill), /must be pinned/);
  await write('skills/example/package.json', { ...pkg, workspaces: ['../sibling'] });
  await assert.rejects(checkSkill(skill), /installs independently/);
  await write('skills/example/package.json', pkg);
  for (const item of [{ link: true }, { resolved: 'file:../sibling' }]) {
    await write('skills/example/package-lock.json', { packages: { '': pkg, 'node_modules/sibling': item } });
    await assert.rejects(checkSkill(skill), /linked dependency|registry URL/);
  }
});

test('retired input, output and project run directories fail the project check', async t => {
  const { root } = await fixture(t);
  for (const path of ['inputs', 'outputs', 'runs', 'skills/example/inputs', 'skills/example/outputs']) {
    await mkdir(join(root, path));
    await assert.rejects(checkProject(root), /Retired path exists/);
    await rm(join(root, path), { recursive: true });
  }
});

test('the index has one entry per skill and keeps style rules in that skill', async t => {
  const { root, write, style } = await fixture(t);
  for (const [styles, error] of [
    [[style, style], /Duplicate style IDs/],
    [[{ ...style, hard_constraints: ['duplicated rule'] }], /Keep style rules inside/],
    [[{ ...style, requirements_ref: 'styles/example/requirements.md' }], /strictly equal/],
    [[], /deep-equal/],
  ]) {
    await write('styles/index.json', { styles });
    await assert.rejects(checkProject(root), error);
  }
});
