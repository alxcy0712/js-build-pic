import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { copyDelivery, deliveryFiles } from './delivery-files.mjs';
import { checkSkill } from './check-structure.mjs';

test('Git inventory excludes untracked files and accepts only explicit regular source additions', async t => {
  const parent = await mkdtemp(join(tmpdir(), '交付清单 with spaces '));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const source = join(parent, 'source'), target = join(parent, 'copy');
  await mkdir(source);
  execFileSync('git', ['init', '--quiet'], { cwd: source });
  await writeFile(join(source, 'entry.txt'), 'entry');
  await writeFile(join(source, 'candidate.txt'), 'candidate');
  await writeFile(join(source, 'local-only.txt'), 'local');
  execFileSync('git', ['add', 'entry.txt'], { cwd: source });
  await mkdir(join(source, 'runs'));
  await writeFile(join(source, 'runs', 'ignored.txt'), 'execution artifact');
  assert.deepEqual(await deliveryFiles(source), ['entry.txt']);
  const paths = await deliveryFiles(source, ['candidate.txt']);
  await copyDelivery(source, target, paths);
  assert.deepEqual((await readdir(target)).sort(), ['candidate.txt', 'entry.txt']);
  assert.equal(await readFile(join(target, 'candidate.txt'), 'utf8'), 'candidate');
  for (const path of ['runs/ignored.txt', '../outside', 'missing.txt']) await assert.rejects(deliveryFiles(source, [path]));
  await symlink(join(source, 'entry.txt'), join(source, 'linked.txt'));
  await assert.rejects(deliveryFiles(source, ['linked.txt']), /regular file/);
  await assert.rejects(copyDelivery(source, join(source, 'nested-copy'), paths), /outside/);
});

test('a required reference outside the supplied delivery list fails before copying', async t => {
  const base = await mkdtemp(join(tmpdir(), 'delivery-boundary-'));
  const skill = join(base, 'example');
  t.after(() => rm(base, { recursive: true, force: true }));
  await mkdir(skill);
  const pkg = { name: 'example', version: '1.0.0', scripts: { test: 'node --test', demo: 'node demo.mjs' } };
  await writeFile(join(skill, 'package.json'), JSON.stringify(pkg));
  await writeFile(join(skill, 'package-lock.json'), JSON.stringify({ packages: { '': pkg } }));
  await writeFile(join(skill, 'SKILL.md'), 'name: example\nmetadata:\n  version: "1.0.0"\n[Required](rule.txt)');
  await writeFile(join(skill, 'rule.txt'), 'untracked rule');
  await assert.rejects(checkSkill(skill, ['SKILL.md', 'package.json', 'package-lock.json']), /missing from delivery/);
  await checkSkill(skill, ['SKILL.md', 'package.json', 'package-lock.json', 'rule.txt']);
});
