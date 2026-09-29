#!/usr/bin/env node
// Static/local validation only. Does not install anything or run documented cloud commands.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const skill = 'skills/hypit-h3-video-replica';
export const publishFiles = [
  '.gitattributes', '.gitignore', 'README.md', 'NOTICE.md', 'package.json',
  `${skill}/SKILL.md`, `${skill}/agents/openai.yaml`,
  `${skill}/assets/h3-baseline.json`, `${skill}/assets/task.example.json`,
  `${skill}/scripts/doctor.mjs`, `${skill}/scripts/local-handoff.mjs`,
  `${skill}/references/installation.md`, `${skill}/references/tutorial.md`, `${skill}/references/verification.md`,
  'tests/doctor.test.mjs', 'tests/local-handoff.test.mjs', 'tools/verify-package.mjs',
].sort();

const ignored = new Set(['.git', 'agent_memory', 'verification-local']);
async function walk(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (dir === root && ignored.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await walk(path));
    else found.push(relative(root, path));
  }
  return found;
}

function syntax(command, args, input, label) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.error?.message}`);
}

async function main() {
  assert.deepEqual((await walk(root)).sort(), publishFiles, 'Unexpected file outside the publication allowlist');
  let links = 0; let bashExamples = 0; let embeddedModules = 0;
  const privatePatterns = [
    /\/(?:Users|Volumes)\//,
    /[A-Za-z]:\\Users\\/,
    /\bcpod-[a-z0-9]{8,}\b/i,
    /\bgh[pousr]_[A-Za-z0-9]{16,}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /https?:\/\/[^\s)]+\.feishu\.cn\/(?:docx|wiki|base)\//,
  ];
  for (const file of publishFiles) {
    const path = join(root, file); const info = await lstat(path);
    assert.ok(info.isFile() && !info.isSymbolicLink(), `Not a regular publication file: ${file}`);
    assert.ok(info.size > 0 && info.size < 200000, `Unexpected size: ${file}`);
    const text = await readFile(path, 'utf8');
    for (const pattern of privatePatterns) assert.ok(!pattern.test(text), `Possible private data in ${file}`);
    if (file.endsWith('.json')) JSON.parse(text);
    if (file.endsWith('.mjs')) syntax(process.execPath, ['--check', path], undefined, file);
    if (!file.endsWith('.md')) continue;
    assert.equal((text.match(/^```/gm) || []).length % 2, 0, `Unbalanced fences: ${file}`);
    for (const match of text.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      let target = match[1].trim().replace(/^<|>$/g, '');
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      target = target.split('#')[0];
      assert.ok(target && !target.startsWith('/'), `Nonportable link in ${file}`);
      const resolved = resolve(dirname(path), decodeURIComponent(target));
      const delta = relative(root, resolved);
      assert.ok(!delta.startsWith('..'), `Link leaves package in ${file}`);
      assert.ok((await lstat(resolved)).isFile(), `Missing link in ${file}`); links++;
    }
    for (const block of text.matchAll(/^```bash\n([\s\S]*?)^```/gm)) {
      syntax('bash', ['-n'], block[1], file); bashExamples++;
    }
    for (const block of text.matchAll(/<<'NODE'\n([\s\S]*?)^NODE$/gm)) {
      syntax(process.execPath, ['--check', '--input-type=module'], block[1], file); embeddedModules++;
    }
  }
  const template = JSON.parse(await readFile(join(root, skill, 'assets/task.example.json'), 'utf8'));
  assert.equal(template.maxHourlyYuan, null); assert.equal(template.maxTotalYuan, null);
  assert.ok(template.authorization.includes('<')); assert.ok(template.endingLine.includes('<'));
  const baseline = JSON.parse(await readFile(join(root, skill, 'assets/h3-baseline.json'), 'utf8'));
  assert.equal(baseline.files.length, 43); assert.match(baseline.commit, /^[a-f0-9]{40}$/);
  assert.equal(new Set(baseline.files.map(x => x.path)).size, 43);
  for (const item of baseline.files) assert.match(item.sha256, /^[a-f0-9]{64}$/);
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(metadata.private, true); assert.equal(metadata.dependencies, undefined);
  assert.equal(metadata.scripts.postinstall, undefined);
  const index = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  if (index.status === 0 && index.stdout) assert.deepEqual(index.stdout.split('\0').filter(Boolean).sort(), publishFiles, 'Git index contains a non-allowlisted file');
  console.log(JSON.stringify({ files: publishFiles.length, relativeLinks: links, bashExamples, embeddedModules, privacyScan: 'passed', credentialReads: 0, cloudActions: 0, documentCommandsExecuted: false }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
