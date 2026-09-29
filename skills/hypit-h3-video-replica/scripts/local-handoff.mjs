#!/usr/bin/env node
// Local files only: no API calls, credential reads, subprocesses, or GPU actions.
import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const usage = `Local support for tutorial v1.1.1 (Node >=22.15).
  bind --plugin-root PATH --config PATH --max-hourly YUAN
  artifact --manifest PATH --within OUTPUT_DIRECTORY
  concat-list --first MP4 --second MP4 --output TXT
  new-instance-baseline --creation-receipt JSON --output JSON
  usage-snapshot --resource-id ID --output JSON  (CompShare JSON on stdin)
  usage-diff --before JSON --after JSON
These commands do not connect to a service or start a resource.`;

async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
function requireValue(value, name) {
  if (!value || String(value).includes('<') || String(value).includes('填写')) throw new Error(`Fill ${name} before running.`);
  return value;
}
function positive(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number.`);
  return n;
}
function nonNegativeNumber(value, name) {
  if (value == null || !['number', 'string'].includes(typeof value) || (typeof value === 'string' && value.trim() === '') || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(`${name} unavailable; do not replace unknown values with zero.`);
  }
  return Number(value);
}
async function missing(path) {
  try { await access(path); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  throw new Error(`Refusing to overwrite ${path}`);
}
async function newJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
async function mp4(path) {
  const actual = await realpath(path);
  const info = await stat(actual);
  if (!info.isFile() || !info.size || extname(actual).toLowerCase() !== '.mp4') throw new Error(`Not a nonempty MP4: ${path}`);
  if (/[\r\n]/.test(actual)) throw new Error('Media paths cannot contain line breaks.');
  return actual;
}
function inside(path, root) {
  const delta = relative(root, path);
  return delta !== '..' && !delta.startsWith('..' + sep) && !isAbsolute(delta);
}

try {
  const { positionals, values: v } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' },
    'plugin-root': { type: 'string' }, config: { type: 'string' }, 'max-hourly': { type: 'string' },
    manifest: { type: 'string' }, within: { type: 'string' }, first: { type: 'string' }, second: { type: 'string' },
    output: { type: 'string' }, 'resource-id': { type: 'string' }, before: { type: 'string' }, after: { type: 'string' },
    'creation-receipt': { type: 'string' },
  }});
  if (v.help) { console.log(usage); process.exit(0); }
  const [command] = positionals;
  if (positionals.length !== 1) throw new Error(usage);

  if (command === 'bind') {
    const plugin = await realpath(requireValue(v['plugin-root'], '--plugin-root'));
    const meta = await json(join(plugin, '.codex-plugin/plugin.json'));
    if (meta.version !== '0.1.0') throw new Error('This helper was checked with plugin 0.1.0; review the new config schema first.');
    const configPath = await realpath(requireValue(v.config, '--config'));
    const config = await json(configPath);
    if (config.provider?.type !== 'compshare' || !config.deploymentBinding) throw new Error('Not a supported H3 project config.');
    if (config.provider.resourceId) throw new Error('This command only prepares a new, unattached config. Preserve an existing instance binding.');
    if (config.safety?.scheduleStopAfter !== '30m' || config.safety?.stopAfterJob !== true) throw new Error('Keep the tutorial safety settings: 30m fallback and stopAfterJob=true.');
    const source = resolve(plugin, 'runtime', config.deploymentBinding);
    const binding = await json(source);
    if (binding.safety?.scheduleStopAfter !== '30m') throw new Error('Review the binding fallback before changing it.');
    const ceiling = positive(requireValue(v['max-hourly'], '--max-hourly'), '--max-hourly');
    const destination = join(dirname(configPath), 'bindings', 'h3-tutorial-binding.json');
    const backup = configPath + '.before-tutorial-bind.json';
    const temporary = configPath + '.tutorial-pending';
    for (const path of [destination, backup, temporary]) await missing(path);
    const local = { ...binding, id: `${binding.id}-tutorial-project`, maximumHourlyPrice: ceiling };
    await copyFile(configPath, backup, constants.COPYFILE_EXCL);
    await newJson(destination, local);
    await newJson(temporary, { ...config, deploymentBinding: destination });
    await rename(temporary, configPath);
    console.log(JSON.stringify({ configPath, backup, bindingPath: destination, maximumHourlyPrice: ceiling, cloudActions: 0 }, null, 2));
  } else if (command === 'artifact') {
    const manifestPath = await realpath(requireValue(v.manifest, '--manifest'));
    const root = await realpath(requireValue(v.within, '--within'));
    if (!inside(manifestPath, root)) throw new Error('Manifest is outside the selected segment output directory.');
    const manifest = await json(manifestPath);
    if (manifest.status !== 'succeeded' || !manifest.prompt_id || !manifest.artifact_path) throw new Error('Task has no confirmed successful output; inspect or recover it instead of resubmitting.');
    const artifact = await mp4(resolve(dirname(manifestPath), manifest.artifact_path));
    if (!inside(artifact, dirname(manifestPath))) throw new Error('Artifact is outside its job directory.');
    console.log(artifact);
  } else if (command === 'concat-list') {
    const first = await mp4(requireValue(v.first, '--first'));
    const second = await mp4(requireValue(v.second, '--second'));
    const output = resolve(requireValue(v.output, '--output'));
    if (extname(output).toLowerCase() !== '.txt') throw new Error('Concat list must be a TXT file.');
    const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `file ${quote(first)}\nfile ${quote(second)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(output);
  } else if (command === 'new-instance-baseline') {
    const receiptPath = await realpath(requireValue(v['creation-receipt'], '--creation-receipt'));
    const receipt = await json(receiptPath);
    const created = receipt.created;
    const rate = created?.status?.billing?.instanceHourly;
    if (!created?.resourceId || created.status?.resourceId !== created.resourceId || created.status?.billing?.chargeType !== 'Postpay') throw new Error('A successful new postpaid instance creation receipt is required.');
    const snapshot = { resourceId: created.resourceId, checkedAt: new Date().toISOString(), usageSeconds: 0, instanceHourlyYuan: nonNegativeNumber(rate, 'Instance rate'), baselineKind: 'new-instance-created-for-this-task', creationReceipt: receiptPath };
    await newJson(resolve(requireValue(v.output, '--output')), snapshot);
    console.log(JSON.stringify(snapshot, null, 2));
  } else if (command === 'usage-snapshot') {
    const resourceId = requireValue(v['resource-id'], '--resource-id');
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const envelope = JSON.parse(input);
    if (envelope.ok !== true) throw new Error('Provider did not return a successful usage readback.');
    const instance = envelope.data?.Instances?.find((item) => item.UHostId === resourceId);
    if (!instance) throw new Error('Selected resource is missing from the response.');
    const usage = nonNegativeNumber(instance.UsageSeconds, 'Usage');
    const rate = nonNegativeNumber(instance.InstancePrice, 'Instance rate');
    const snapshot = { resourceId, checkedAt: new Date().toISOString(), usageSeconds: usage, instanceHourlyYuan: rate, diskHourlyYuan: instance.DiskPrice ?? null, imageHourlyYuan: instance.CompShareImagePrice ?? null };
    const output = resolve(requireValue(v.output, '--output'));
    await newJson(output, snapshot);
    console.log(JSON.stringify(snapshot, null, 2));
  } else if (command === 'usage-diff') {
    const before = await json(requireValue(v.before, '--before'));
    const after = await json(requireValue(v.after, '--after'));
    if (!before.resourceId || before.resourceId !== after.resourceId) throw new Error('Usage snapshots belong to different resources.');
    for (const item of [before, after]) if (!Number.isFinite(item.usageSeconds) || item.usageSeconds < 0 || !Number.isFinite(item.instanceHourlyYuan) || item.instanceHourlyYuan < 0) throw new Error('Incomplete usage snapshot.');
    const delta = after.usageSeconds - before.usageSeconds;
    if (delta < 0 || before.instanceHourlyYuan !== after.instanceHourlyYuan) throw new Error('Usage counter reset or rate changed; inspect provider records before estimating.');
    console.log(JSON.stringify({ resourceId: before.resourceId, usageSeconds: delta, instanceHourlyYuan: after.instanceHourlyYuan, instanceUsageEstimateYuan: Number((delta / 3600 * after.instanceHourlyYuan).toFixed(6)), excludesOtherFees: true, isSettledInvoice: false }, null, 2));
  } else { throw new Error(usage); }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
