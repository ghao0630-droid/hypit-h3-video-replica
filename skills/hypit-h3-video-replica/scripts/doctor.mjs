#!/usr/bin/env node
// Local-only preflight. No account queries, network calls or credential files.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const run = promisify(execFile);
const skillRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function versionAtLeast(value, minimum) {
  const match = String(value).match(/(?:^|\s)v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts[i] > minimum[i]) return true;
    if (parts[i] < minimum[i]) return false;
  }
  return true;
}

export async function checkPlugin(path, baseline) {
  if (!path) return { ready: false, reason: 'H3 plugin root not provided' };
  const root = await realpath(path);
  const metadata = JSON.parse(await readFile(join(root, '.codex-plugin/plugin.json'), 'utf8'));
  if (metadata.version !== baseline.pluginVersion) return { ready: false, reason: 'Plugin version differs from this tutorial baseline' };
  const mismatches = [];
  for (const file of baseline.files) {
    if (file.path.startsWith('/') || file.path.split('/').includes('..')) throw new Error('Invalid baseline path');
    try {
      const bytes = await readFile(join(root, file.path));
      if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) mismatches.push(file.path);
    } catch { mismatches.push(file.path); }
  }
  for (const name of ['h3-onboard', 'h3-provision', 'h3-cloud']) {
    try { await access(join(root, 'scripts', name), constants.X_OK); }
    catch { mismatches.push(`scripts/${name} (not executable)`); }
  }
  return { ready: mismatches.length === 0, expectedCommit: baseline.commit, filesChecked: baseline.files.length, mismatches };
}

async function probe(command, args) {
  try {
    const result = await run(command, args, { timeout: 10000, maxBuffer: 262144 });
    return { available: true, version: (result.stdout || result.stderr).trim().split('\n')[0].slice(0, 200) };
  } catch (error) { return { available: false, reason: error.code === 'ENOENT' ? 'Not found in PATH' : 'Local version command failed' }; }
}

async function main() {
  const { values } = parseArgs({ options: { help: { type: 'boolean', short: 'h' }, 'h3-plugin-root': { type: 'string' } } });
  if (values.help) {
    console.log('Usage: node doctor.mjs [--h3-plugin-root PATH]\nLocal versions and public plugin files only; no credentials, APIs or GPU actions.');
    return;
  }
  const commands = {
    npm: ['npm', ['--version']], python: ['python3', ['--version']],
    ssh: ['ssh', ['-V']], ffmpeg: ['ffmpeg', ['-version']],
    ffprobe: ['ffprobe', ['-version']], compshare: ['compshare', ['--version']],
    hypit: ['hypit', ['--version']],
  };
  const tools = Object.fromEntries(await Promise.all(Object.entries(commands).map(async ([name, args]) => [name, await probe(...args)])));
  const baseline = JSON.parse(await readFile(join(skillRoot, 'assets/h3-baseline.json'), 'utf8'));
  let plugin;
  try { plugin = await checkPlugin(values['h3-plugin-root'], baseline); }
  catch { plugin = { ready: false, reason: 'Cannot read the selected plugin baseline' }; }
  const issues = [];
  if (!versionAtLeast(process.version, [22, 20, 0])) issues.push('Node >=22.20.0 is required by the selected skills installer');
  for (const name of ['npm', 'python', 'ssh', 'ffmpeg', 'ffprobe', 'compshare']) {
    if (!tools[name].available) issues.push(`${name} is unavailable`);
  }
  if (tools.python.available && !versionAtLeast(tools.python.version, [3, 9, 0])) issues.push('Python >=3.9.0 is required');
  if (tools.compshare.available && !/\b0\.4\.4\b/.test(tools.compshare.version)) issues.push('CompShare differs from tested 0.4.4; review CLI compatibility before using the tutorial');
  if (!plugin.ready) issues.push('H3 plugin baseline is not verified');
  console.log(JSON.stringify({
    node: process.version, tools, plugin, issues,
    readyForLocalPreparation: issues.length === 0,
    warnings: tools.hypit.available ? [] : ['Hypit CLI is optional and not found; use the local FFmpeg route'],
    accountVerified: false, inventoryVerified: false, generationVerified: false, paidActions: 0,
  }, null, 2));
  if (issues.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
