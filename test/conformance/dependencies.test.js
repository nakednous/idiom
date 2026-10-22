/**
 * @file The dependency line — the package's only dependency is tree, and no
 *       source module imports anything else. This test fails when either grows.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function manifest() {
  return JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
}

test('the dependency list is @nakednous/tree alone', async () => {
  const pkg = await manifest();
  assert.deepEqual(Object.keys(pkg.dependencies || {}), ['@nakednous/tree']);
});

test('no source module imports anything outside the package but tree', async () => {
  const files = (await readdir(join(root, 'src'))).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 0, 'the package has source modules');
  const external = new Set();
  for (const file of files) {
    const source = await readFile(join(root, 'src', file), 'utf8');
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      if (spec.startsWith('./') || spec.startsWith('../')) continue;
      external.add(spec);
    }
  }
  assert.deepEqual([...external], ['@nakednous/tree']);
});
