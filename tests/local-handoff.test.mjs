import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const helper = join(root, 'skills/hypit-h3-video-replica/scripts/local-handoff.mjs');
async function fixture() { return mkdtemp(join(tmpdir(), 'h3-handoff-test-')); }
async function json(path, value) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)); }
function call(args, input) { return spawnSync(process.execPath, [helper, ...args], { input, encoding: 'utf8' }); }
function succeeded(result) { assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); }
function refused(result) { assert.notEqual(result.status, 0); }

test('usage diff separates baseline and cumulative use without calling a provider', async () => {
  const dir = await fixture(); const before = join(dir, 'before.json'); const after = join(dir, 'after.json');
  await json(before, { resourceId: 'fixture-instance', usageSeconds: 371, instanceHourlyYuan: 3.2 });
  await json(after, { resourceId: 'fixture-instance', usageSeconds: 1335, instanceHourlyYuan: 3.2 });
  const result = JSON.parse(succeeded(call(['usage-diff', '--before', before, '--after', after])));
  assert.equal(result.usageSeconds, 964); assert.equal(result.instanceUsageEstimateYuan, 0.856889);
  assert.equal(result.isSettledInvoice, false); assert.equal(result.excludesOtherFees, true);
});

test('usage diff rejects resource, rate and counter mismatches', async () => {
  const dir = await fixture(); const before = join(dir, 'before.json'); const after = join(dir, 'after.json');
  await json(before, { resourceId: 'one', usageSeconds: 10, instanceHourlyYuan: 3.2 });
  for (const value of [
    { resourceId: 'two', usageSeconds: 20, instanceHourlyYuan: 3.2 },
    { resourceId: 'one', usageSeconds: 20, instanceHourlyYuan: 3.3 },
    { resourceId: 'one', usageSeconds: 5, instanceHourlyYuan: 3.2 },
    { resourceId: 'one', usageSeconds: null, instanceHourlyYuan: 3.2 },
  ]) { await json(after, value); refused(call(['usage-diff', '--before', before, '--after', after])); }
});

test('snapshot contains only selected billing fields and refuses overwrite', async () => {
  const dir = await fixture(); const output = join(dir, 'snapshot.json');
  const envelope = { ok: true, data: { Instances: [{ UHostId: 'fixture-instance', UsageSeconds: 1335, InstancePrice: 3.2, irrelevantField: 'do-not-copy' }] } };
  const args = ['usage-snapshot', '--resource-id', 'fixture-instance', '--output', output];
  const value = JSON.parse(succeeded(call(args, JSON.stringify(envelope))));
  assert.equal(value.usageSeconds, 1335); assert.equal(value.diskHourlyYuan, null);
  assert.equal(value.irrelevantField, undefined); assert.equal(value.InstancePrice, undefined);
  const original = await readFile(output, 'utf8'); refused(call(args, JSON.stringify(envelope)));
  assert.equal(await readFile(output, 'utf8'), original);
});

test('snapshot rejects missing, blank and boolean numeric data', async () => {
  const dir = await fixture(); let count = 0;
  for (const invalid of [null, '', ' ', true, false, -1, 'not-a-number']) {
    for (const field of ['UsageSeconds', 'InstancePrice']) {
      const envelope = { ok: true, data: { Instances: [{ UHostId: 'fixture-instance', UsageSeconds: 1, InstancePrice: 3.2, [field]: invalid }] } };
      refused(call(['usage-snapshot', '--resource-id', 'fixture-instance', '--output', join(dir, `invalid-${count++}.json`)], JSON.stringify(envelope)));
    }
  }
  refused(call(['usage-snapshot', '--resource-id', 'fixture-instance', '--output', join(dir, 'failed.json')], JSON.stringify({ ok: false, data: {} })));
});

test('new-instance baseline requires a matching successful postpaid creation receipt', async () => {
  const dir = await fixture(); const receipt = join(dir, 'create.json'); const output = join(dir, 'zero.json');
  await json(receipt, { created: { resourceId: 'new-instance', status: { resourceId: 'new-instance', billing: { chargeType: 'Postpay', instanceHourly: 3.2 } } } });
  const value = JSON.parse(succeeded(call(['new-instance-baseline', '--creation-receipt', receipt, '--output', output])));
  assert.equal(value.usageSeconds, 0); assert.equal(value.baselineKind, 'new-instance-created-for-this-task');
  await json(receipt, { created: { resourceId: 'new-instance', status: { resourceId: 'wrong-instance', billing: { chargeType: 'Postpay', instanceHourly: 3.2 } } } });
  refused(call(['new-instance-baseline', '--creation-receipt', receipt, '--output', join(dir, 'wrong.json')]));
});

test('artifact returns the successful job file and rejects wrong state or segment', async () => {
  const dir = await fixture(); const segment = join(dir, 'segment-01'); const job = join(segment, 'job');
  await mkdir(job, { recursive: true }); const mp4 = join(job, 'fixture.mp4'); await writeFile(mp4, 'fixture bytes, not a playable media test');
  const manifest = join(job, 'manifest.json'); const record = { status: 'succeeded', prompt_id: 'fixture-task', artifact_path: mp4 };
  await json(manifest, record);
  assert.equal(succeeded(call(['artifact', '--manifest', manifest, '--within', segment])), await realpath(mp4));
  refused(call(['artifact', '--manifest', manifest, '--within', await fixture()]));
  await json(manifest, { ...record, status: 'failed' }); refused(call(['artifact', '--manifest', manifest, '--within', segment]));
  await json(manifest, { ...record, prompt_id: '' }); refused(call(['artifact', '--manifest', manifest, '--within', segment]));
});

test('artifact refuses a symlink escaping its job directory', async () => {
  const dir = await fixture(); const job = join(dir, 'segment', 'job'); await mkdir(job, { recursive: true });
  const other = join(dir, 'outside.mp4'); await writeFile(other, 'fixture'); const link = join(job, 'linked.mp4'); await symlink(other, link);
  const manifest = join(job, 'manifest.json'); await json(manifest, { status: 'succeeded', prompt_id: 'fixture-task', artifact_path: link });
  refused(call(['artifact', '--manifest', manifest, '--within', join(dir, 'segment')]));
});

test('concat-list quotes apostrophes and never replaces an existing file', async () => {
  const dir = await fixture(); const first = join(dir, "甲 空格'片.mp4"); const second = join(dir, '乙.mp4');
  await writeFile(first, 'fixture'); await writeFile(second, 'fixture'); const output = join(dir, 'concat.txt');
  const args = ['concat-list', '--first', first, '--second', second, '--output', output]; succeeded(call(args));
  const text = await readFile(output, 'utf8'); assert.ok(text.includes("'\\''")); assert.equal(text.split('\n').filter(Boolean).length, 2);
  refused(call(args)); assert.equal(await readFile(output, 'utf8'), text);
});

test('bind changes only a project binding and preserves source and config backup', async () => {
  const dir = await fixture(); const plugin = join(dir, 'plugin'); const config = join(dir, 'project', 'h3.json');
  const source = join(plugin, 'runtime', 'binding.json');
  const binding = { id: 'fixture-binding', maximumHourlyPrice: 2.6, runtimeSpec: 'runtime.json', safety: { scheduleStopAfter: '30m' } };
  const value = { provider: { type: 'compshare', resourceId: '' }, deploymentBinding: 'binding.json', safety: { scheduleStopAfter: '30m', stopAfterJob: true } };
  await json(join(plugin, '.codex-plugin/plugin.json'), { version: '0.1.0' }); await json(source, binding); await json(config, value);
  const original = await readFile(config, 'utf8'); const args = ['bind', '--plugin-root', plugin, '--config', config, '--max-hourly', '3.3'];
  const result = JSON.parse(succeeded(call(args))); assert.equal(result.cloudActions, 0);
  assert.equal(await readFile(config + '.before-tutorial-bind.json', 'utf8'), original);
  assert.deepEqual(JSON.parse(await readFile(source, 'utf8')), binding);
  const updated = JSON.parse(await readFile(result.bindingPath, 'utf8'));
  assert.deepEqual(updated, { ...binding, id: 'fixture-binding-tutorial-project', maximumHourlyPrice: 3.3 });
  refused(call(args));
});

test('bind rejects an existing instance, changed safety, version and invalid ceiling', async () => {
  const dir = await fixture(); const plugin = join(dir, 'plugin'); const config = join(dir, 'h3.json');
  await json(join(plugin, '.codex-plugin/plugin.json'), { version: '0.1.0' });
  await json(join(plugin, 'runtime/binding.json'), { id: 'fixture', safety: { scheduleStopAfter: '30m' } });
  const value = { provider: { type: 'compshare', resourceId: '' }, deploymentBinding: 'binding.json', safety: { scheduleStopAfter: '30m', stopAfterJob: true } };
  const args = ['bind', '--plugin-root', plugin, '--config', config, '--max-hourly', '3.3'];
  for (const altered of [{ ...value, provider: { type: 'compshare', resourceId: 'existing-instance' } }, { ...value, safety: { scheduleStopAfter: '30m', stopAfterJob: false } }]) {
    await json(config, altered); refused(call(args));
  }
  await json(config, value); refused(call([...args.slice(0, -1), '0']));
  await json(join(plugin, '.codex-plugin/plugin.json'), { version: '9.9.9' }); refused(call(args));
});
