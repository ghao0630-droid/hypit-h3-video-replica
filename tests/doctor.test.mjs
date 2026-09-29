import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkPlugin, versionAtLeast } from '../skills/hypit-h3-video-replica/scripts/doctor.mjs';

test('version comparison respects the installers actual minimum', () => {
  assert.equal(versionAtLeast('v22.20.0', [22, 20, 0]), true);
  assert.equal(versionAtLeast('v22.19.0', [22, 20, 0]), false);
  assert.equal(versionAtLeast('v24.13.0', [22, 20, 0]), true);
  assert.equal(versionAtLeast('unknown', [22, 20, 0]), false);
  assert.equal(versionAtLeast('Python 3.9.6', [3, 9, 0]), true);
});

test('plugin check matches bytes, rejects tampering and executes no plugin scripts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'h3-doctor-test-'));
  await mkdir(join(root, '.codex-plugin'), { recursive: true }); await mkdir(join(root, 'scripts'));
  await writeFile(join(root, '.codex-plugin/plugin.json'), JSON.stringify({ version: '0.1.0' }));
  for (const name of ['h3-onboard', 'h3-provision', 'h3-cloud']) {
    await writeFile(join(root, 'scripts', name), '#!/bin/sh\nexit 99\n'); await chmod(join(root, 'scripts', name), 0o755);
  }
  const bytes = await readFile(join(root, 'scripts/h3-cloud'));
  const baseline = { pluginVersion: '0.1.0', commit: 'fixture-commit', files: [{ path: 'scripts/h3-cloud', sha256: createHash('sha256').update(bytes).digest('hex') }] };
  assert.equal((await checkPlugin(root, baseline)).ready, true);
  await writeFile(join(root, 'scripts/h3-cloud'), '#!/bin/sh\nexit 98\n');
  const changed = await checkPlugin(root, baseline); assert.equal(changed.ready, false); assert.ok(changed.mismatches.includes('scripts/h3-cloud'));
});

test('plugin check treats missing root as unready rather than account readiness', async () => {
  assert.equal((await checkPlugin('', {})).ready, false);
});

test('plugin check refuses an unsafe baseline path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'h3-doctor-path-test-')); await mkdir(join(root, '.codex-plugin'));
  await writeFile(join(root, '.codex-plugin/plugin.json'), JSON.stringify({ version: '0.1.0' }));
  await assert.rejects(checkPlugin(root, { pluginVersion: '0.1.0', files: [{ path: '../escape', sha256: '' }] }));
});
