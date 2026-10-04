import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const excluded = new Set(['.git', 'runs', 'node_modules', '.cache', '.codex', '.agents', '.aws']);

export async function deliveryFiles(base, additions = []) {
  base = await realpath(base);
  const { stdout } = await exec('git', ['ls-files', '--cached', '-z'], { cwd: base, maxBuffer: 4 * 1024 * 1024 });
  const paths = [...new Set([...stdout.split('\0').filter(Boolean), ...additions])].sort();
  for (const path of paths) {
    assert.ok(!isAbsolute(path) && path && !path.split(/[\\/]/).some(part => part === '..' || excluded.has(part)), `Invalid delivery path: ${path}`);
    assert.ok((await lstat(join(base, path))).isFile(), `Delivery requires a regular file: ${path}`);
    assert.equal(await realpath(join(base, path)), join(base, path), `Delivery path contains a symlink: ${path}`);
  }
  return paths;
}

export async function copyDelivery(base, target, paths) {
  const rel = relative(base, target);
  assert.ok(isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep), 'Delivery copy must be outside its source');
  await mkdir(target);
  for (const path of paths) {
    // Recheck each source before copying; parent symlinks are checked by the source structure audit.
    assert.ok((await lstat(join(base, path))).isFile(), `Delivery requires a regular file: ${path}`);
    await mkdir(dirname(join(target, path)), { recursive: true });
    await copyFile(join(base, path), join(target, path));
  }
}
