import assert from 'node:assert/strict';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const ignored = new Set(['node_modules', '.cache', 'runs', '.git']);

export function assertContained(base, target) {
  const rel = relative(base, target);
  assert.ok(!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep), `Reference escapes folder: ${target}`);
}

async function localReference(base, file, reference) {
  const target = resolve(dirname(file), decodeURIComponent(reference.split('#')[0]));
  assertContained(base, target);
  assert.ok(!relative(base, target).split(sep).some(part => ignored.has(part)), `Reference uses generated files: ${file} -> ${reference}`);
  assertContained(base, await realpath(target));
}

async function* files(directory, excluded = ignored) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Source contains a symlink: ${path}`);
    if (entry.isDirectory()) yield* files(path, excluded);
    else yield path;
  }
}

async function checkLinks(base, file, content) {
  const links = /\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)|^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm;
  for (const match of content.matchAll(links)) {
    const href = match[1] ?? match[2];
    if (/^(?:https?:|mailto:|#)/i.test(href)) continue;
    await localReference(base, file, href);
  }
}

async function assertAbsent(base, paths) {
  for (const path of paths) {
    const target = join(base, path);
    const entry = await lstat(target).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    assert.equal(entry, undefined, `Retired path exists: ${target}`);
  }
}

export async function checkSkill(base) {
  base = await realpath(base);
  await assertAbsent(base, ['inputs', 'outputs']);
  const pkg = JSON.parse(await readFile(join(base, 'package.json')));
  const lock = JSON.parse(await readFile(join(base, 'package-lock.json')));
  const entrypoint = await readFile(join(base, 'SKILL.md'), 'utf8');
  assert.equal(pkg.name, basename(base));
  assert.equal(entrypoint.match(/^name: (.+)$/m)?.[1], pkg.name);
  assert.equal(entrypoint.match(/^  version: "([^"]+)"$/m)?.[1], pkg.version);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.ok(pkg.scripts?.test && pkg.scripts?.demo, 'Skill requires test and demo commands');
  assert.equal(pkg.workspaces, undefined, 'Each skill installs independently');
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  for (const [name, version] of Object.entries(dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, `Dependency must be pinned: ${name}`);
  }
  for (const item of Object.values(lock.packages)) {
    assert.ok(!item.link, 'Lockfile contains a linked dependency');
    if (item.resolved) assert.match(item.resolved, /^https:\/\//, 'Lockfile dependency must use a registry URL');
  }
  for await (const file of files(base)) {
    const extension = extname(file);
    if (!['.md', '.txt', '.json', '.yaml', '.yml', '.mjs', '.js', '.cjs', '.ts', '.sh'].includes(extension)) continue;
    const content = await readFile(file, 'utf8');
    if (extension === '.json') JSON.parse(content);
    if (extension === '.md') await checkLinks(base, file, content);
    // Tests contain deliberately invalid paths; imports still obey the package boundary.
    if (!relative(base, file).startsWith('tests' + sep) && basename(file) !== 'package-lock.json') {
      assert.doesNotMatch(content, /(?:\/Users\/|\/home\/|\/private\/|\/tmp\/|[A-Z]:\\Users\\)/, `Machine-specific path: ${file}`);
      assert.doesNotMatch(content, /(?:^|[\s`"'(])(?:shared|styles|skills|playbooks|context|research)\//m, `Project path in skill: ${file}`);
      for (const [reference] of content.matchAll(/(?:\.\.\/)+(?:[\w.-]+\/)*/g)) {
        assertContained(base, resolve(dirname(file), reference));
      }
    }
    if (['.mjs', '.js', '.cjs', '.ts'].includes(extension)) {
      const imports = /\b(?:from|import)\s*['"]([^'"]+)['"]|\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g;
      for (const match of content.matchAll(imports)) {
        const specifier = match[1] ?? match[2];
        if (isBuiltin(specifier)) continue;
        if (specifier.startsWith('.')) await localReference(base, file, specifier);
        else {
          const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
          assert.ok(Object.hasOwn(dependencies, name), `Undeclared dependency in ${file}: ${specifier}`);
        }
      }
      for (const [, reference] of content.matchAll(/new URL\(['"]([^'"]+)['"],\s*import\.meta\.url\)/g)) {
        await localReference(base, file, reference);
      }
    }
  }
  return pkg;
}

export async function checkProject(base = root) {
  base = await realpath(base);
  await assertAbsent(base, ['inputs', 'outputs', 'runs']);
  const index = JSON.parse(await readFile(join(base, 'styles/index.json')));
  const entries = await readdir(join(base, 'skills'), { withFileTypes: true });
  assert.ok(entries.length > 0, 'No skill folders found');
  assert.ok(entries.every(entry => entry.isDirectory()), 'skills/ contains only independent skill folders');
  assert.equal(new Set(index.styles.map(style => style.id)).size, index.styles.length, 'Duplicate style IDs');
  const allowed = new Set(['id', 'name', 'description', 'status', 'version', 'entrypoint', 'requirements_ref']);
  for (const style of index.styles) {
    assert.ok(Object.keys(style).every(key => allowed.has(key)), `Keep style rules inside the skill: ${style.id}`);
    if (style.entrypoint === null) {
      assert.equal(style.status, 'planned');
      assert.equal(style.requirements_ref, `styles/${style.id}/requirements.md`);
    } else {
      assert.equal(style.entrypoint, `skills/${style.id}/SKILL.md`);
      assert.equal(style.requirements_ref, `skills/${style.id}/references/requirements.md`);
      const pkg = await checkSkill(join(base, 'skills', style.id));
      assert.equal(style.version, pkg.version);
    }
    await localReference(base, join(base, 'index'), style.requirements_ref);
  }
  assert.deepEqual(entries.map(entry => entry.name).sort(), index.styles.filter(style => style.entrypoint).map(style => style.id).sort());
  const planned = index.styles.filter(style => style.entrypoint === null).map(style => style.id).sort();
  assert.deepEqual((await readdir(join(base, 'styles'))).sort(), ['index.json', ...planned].sort(), 'styles/ holds the index and planned styles only');
  for await (const file of files(base, new Set([...ignored, 'skills']))) {
    if (extname(file) === '.md') await checkLinks(base, file, await readFile(file, 'utf8'));
    if (extname(file) === '.json') JSON.parse(await readFile(file, 'utf8'));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkProject();
  console.log('PASS: independent skill boundaries, references, dependencies, index and retired paths');
}
