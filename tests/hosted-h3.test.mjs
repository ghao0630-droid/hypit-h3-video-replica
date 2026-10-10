import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  DEFAULT_RESOLUTION, MAX_IMAGE_BYTES, POINT_RATES, assertInsideOutputs, assertDownloadUrl,
  backoffDelayMs, downloadVideo, estimateCost, formatDebug, pollUntilTerminal, publicTask,
  resumeSubmission, submitNew, toDataUrl,
} from '../skills/hypit-h3-video-replica/scripts/hosted-h3.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const helper = join(root, 'skills/hypit-h3-video-replica/scripts/hosted-h3.mjs');
const secret = 'sk-ml-test-key-not-real';
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x11, 0x22, 0x33]);
const mp4 = Buffer.from([0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00, 0x69, 0x73, 0x6f, 0x6d]);

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
function balance(available, reserved = 0) {
  return { total_points: available + reserved, reserved_points: reserved, available_points: available };
}
async function fixture() { return mkdtemp(join(tmpdir(), 'hosted-h3-')); }
function call(args, env = {}) {
  return spawnSync(process.execPath, [helper, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, ...env } });
}
function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helper, ...args], { env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, ...env } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('CLI timed out')); }, 10000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}
function refused(result) { assert.notEqual(result.status, 0, result.stderr); return result; }

test('estimate defaults to 768P and prices the official table without treating it as an invoice', () => {
  const result = estimateCost();
  assert.equal(DEFAULT_RESOLUTION, '768P');
  assert.equal(result.resolution, '768P');
  assert.notEqual(result.resolution, '480P');
  assert.equal(result.durationSeconds, 5);
  assert.equal(result.count, 1);
  assert.equal(result.pointsPerSecond, 10);
  assert.equal(result.estimatedPoints, 50);
  assert.equal(result.estimatedYuan, 0.45);
  assert.equal(result.packagePoints, 1100);
  assert.equal(result.packageYuan, 9.9);
  assert.equal(result.isSettledInvoice, false);
  assert.deepEqual(result.cliWarnings, []);
  assert.equal(result.productionCheck.chargedPoints, 20);
  assert.equal(result.productionCheck.documentedPoints, 25);
  assert.equal(estimateCost({ resolution: '480P', duration: 5 }).estimatedPoints, 25);
  assert.equal(estimateCost({ resolution: '1080P', duration: 6, count: 2 }).estimatedPoints, 228);
  assert.equal(estimateCost({ resolution: '1080P', duration: 6, count: 2 }).estimatedYuan, 2.052);
  assert.equal(estimateCost({ resolution: '2K', duration: 4 }).estimatedPoints, 80);
  assert.equal(estimateCost({ resolution: '4K', duration: 5 }).pointsPerSecond, 22);
  assert.deepEqual(POINT_RATES, { '480P': 5, '768P': 10, '1080P': 19, '2K': 20, '4K': 22 });
});

test('duration follows the hosted API and warns where the CLI is narrower', () => {
  assert.equal(estimateCost({ duration: 4 }).durationSeconds, 4);
  assert.equal(estimateCost({ duration: 30 }).durationSeconds, 30);
  assert.equal(estimateCost({ duration: 15, resolution: '1080P' }).cliWarnings.length, 0);
  assert.equal(estimateCost({ duration: 16, resolution: '2K' }).cliWarnings.length, 1);
  assert.match(estimateCost({ duration: 16 }).cliWarnings[0], /4-15 seconds/);
  assert.match(estimateCost({ resolution: '480P' }).cliWarnings[0], /768P, 1080P, and 2K/);
  assert.match(estimateCost({ resolution: '4K', duration: 20 }).cliWarnings.join('\n'), /4K/);
  for (const duration of [3, 31, 5.5, 0]) assert.throws(() => estimateCost({ duration }), /4 to 30/);
  for (const resolution of ['768p', '720P', '1K', '1080p', '2k']) assert.throws(() => estimateCost({ resolution }), /case-sensitive/);
});

test('first frame becomes a data URL and rejects other bytes or an oversized file', () => {
  const encoded = toDataUrl(png);
  assert.equal(encoded.mime, 'image/png');
  assert.equal(encoded.url, `data:image/png;base64,${png.toString('base64')}`);
  assert.match(encoded.url, /^data:image\/png;base64,/);
  assert.equal(encoded.sha256.length, 64);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  assert.equal(toDataUrl(jpeg).mime, 'image/jpeg');
  const webp = Buffer.alloc(12);
  webp.write('RIFF', 0);
  webp.write('WEBP', 8);
  assert.equal(toDataUrl(webp).url.startsWith('data:image/webp;base64,'), true);
  assert.throws(() => toDataUrl(Buffer.from('GIF89a')), /PNG, JPEG, or WebP/);
  assert.throws(() => toDataUrl(png, { maxBytes: 4 }), /exceeds 4 bytes/);
  assert.equal(MAX_IMAGE_BYTES, 30 * 1024 * 1024);
  assert.throws(() => toDataUrl('not-bytes'), /file buffer/);
});

test('debug output redacts the bearer token and the data URL', () => {
  const text = formatDebug({
    method: 'POST',
    url: 'https://cp.compshare.cn/minimax/v2/video_generation',
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
    body: { content: [{ type: 'image_url', image_url: { url: toDataUrl(png).url } }] },
  });
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes(png.toString('base64')), false);
  assert.match(text, /Bearer \[redacted\]/);
  assert.match(text, /data:\[redacted length=/);
});

test('manifest is written with a null task id before the first request and resume will not post again', async () => {
  const dir = await fixture();
  const manifestPath = join(dir, 'outputs', 'clip', 'manifest.json');
  const prompt = '人物缓慢转头。';
  const calls = [];
  const logs = [];
  const fetchImpl = async (url, init) => {
    const onDisk = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(onDisk.taskId, null);
    assert.match(onDisk.idempotencyKey, /^[0-9a-f-]{36}$/);
    assert.equal(onDisk.confirmed, true);
    calls.push({ url: String(url), method: init.method, key: init.headers['Idempotency-Key'] || null });
    if (String(url).endsWith('/point_usage_summary')) return jsonResponse(balance(100, 20));
    assert.equal(init.headers['Idempotency-Key'], onDisk.idempotencyKey);
    assert.equal(init.headers.Authorization, `Bearer ${secret}`);
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'MiniMax-H3');
    assert.equal(body.resolution, '768P');
    assert.equal(body.duration, 5);
    assert.equal(body.ratio, '9:16');
    assert.equal(body.mute_audio, true);
    assert.equal(body.content[1].role, 'first_frame');
    assert.equal(body.content[1].image_url.url, toDataUrl(png).url);
    return jsonResponse({ task_id: 'hosted-task-001' });
  };
  const created = await submitNew({
    prompt, firstFrame: png, manifestPath, maxPoints: 80, yes: true, ratio: '9:16', muteAudio: true,
    apiKey: secret, fetchImpl, debugLog: (line) => logs.push(line),
  });
  assert.equal(created.taskId, 'hosted-task-001');
  assert.equal(created.posted, true);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].key, created.idempotencyKey);
  const saved = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(saved.taskId, 'hosted-task-001');
  assert.equal(JSON.stringify(saved).includes('base64'), false);
  assert.equal(JSON.stringify(saved).includes(secret), false);
  assert.equal(JSON.stringify(saved).includes(prompt), false);
  assert.equal((await stat(manifestPath)).mode & 0o777, 0o600);
  assert.equal(logs.join('\n').includes(secret), false);
  assert.equal(logs.join('\n').includes(png.toString('base64')), false);
  const later = [];
  const resumed = await resumeSubmission({
    manifestPath, apiKey: secret,
    fetchImpl: async (url, init) => {
      later.push(init.method);
      assert.equal(init.method, 'GET');
      return jsonResponse({ task: { id: 'hosted-task-001', status: 'moderating', estimated_remaining_seconds: 9 } });
    },
  });
  assert.deepEqual(later, ['GET']);
  assert.equal(resumed.posted, false);
  assert.equal(resumed.status, 'moderating');
  await assert.rejects(() => submitNew({
    prompt, firstFrame: png, manifestPath, maxPoints: 80, yes: true, apiKey: secret,
    fetchImpl: async () => { throw new Error('must not submit twice'); },
  }), /Refusing to overwrite/);
});

test('a failed submit keeps the idempotency key and a later resume posts that same key once', async () => {
  const dir = await fixture();
  const manifestPath = join(dir, 'outputs', 'clip', 'manifest.json');
  const prompt = '保持同一幂等键。';
  let posts = 0;
  let savedKey;
  const fetchImpl = async (url, init) => {
    const onDisk = JSON.parse(await readFile(manifestPath, 'utf8'));
    savedKey = onDisk.idempotencyKey;
    if (String(url).endsWith('/point_usage_summary')) return jsonResponse(balance(90));
    posts += 1;
    assert.equal(init.headers['Idempotency-Key'], savedKey);
    if (posts === 1) throw new Error(`socket hang up Bearer ${secret}`);
    return jsonResponse({ task_id: 'hosted-task-002' });
  };
  await assert.rejects(() => submitNew({ prompt, firstFrame: png, manifestPath, maxPoints: 50, yes: true, apiKey: secret, fetchImpl }), (error) => {
    assert.equal(error.message.includes(secret), false);
    assert.match(error.message, /Manifest kept for resume/);
    return true;
  });
  assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).taskId, null);
  await assert.rejects(() => resumeSubmission({
    manifestPath, prompt: '不同的提示词', firstFrame: png, apiKey: secret,
    fetchImpl: async () => { throw new Error('must not post changed inputs'); },
  }), /does not match/);
  assert.equal(posts, 1);
  const created = await resumeSubmission({ manifestPath, prompt, firstFrame: png, apiKey: secret, fetchImpl });
  assert.equal(created.taskId, 'hosted-task-002');
  assert.equal(created.idempotencyKey, savedKey);
  assert.equal(posts, 2);
});

test('budget and balance guards do not create a second submission', async () => {
  const dir = await fixture();
  const manifestPath = join(dir, 'outputs', 'clip', 'manifest.json');
  const prompt = '预算内才提交。';
  let calls = 0;
  const over = await submitNew({ prompt, firstFrame: png, manifestPath, maxPoints: 49, yes: true, apiKey: secret, fetchImpl: async () => { calls += 1; throw new Error('network'); } });
  assert.equal(over.submitted, false);
  assert.equal(over.reason, 'over-budget');
  assert.equal(over.estimate.estimatedPoints, 50);
  assert.equal(calls, 0);
  await assert.rejects(() => stat(manifestPath), (error) => error.code === 'ENOENT');
  const unconfirmed = await submitNew({ prompt, firstFrame: png, manifestPath, maxPoints: 50, yes: false, fetchImpl: async () => { calls += 1; throw new Error('network'); } });
  assert.equal(unconfirmed.reason, 'missing-yes');
  assert.equal(calls, 0);
  await assert.rejects(() => submitNew({
    prompt, firstFrame: png, manifestPath, maxPoints: 50, yes: true, apiKey: secret,
    fetchImpl: async (url) => {
      calls += 1;
      assert.equal(String(url).includes('/video_generation') && !String(url).includes('/query/'), false);
      return jsonResponse(balance(49));
    },
  }), /No video task was submitted/);
  const blocked = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(blocked.taskId, null);
  assert.equal(blocked.remoteStatus, 'blocked-insufficient-points');
  assert.equal(calls, 1);
});

test('wait backs off through moderating and running and does not treat timeout as success', async () => {
  const statuses = ['moderating', 'running', 'succeeded'];
  const sleeps = [];
  let clock = 0;
  const done = await pollUntilTerminal({
    timeoutMs: 100000, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    fetchTask: async () => ({ id: 'hosted-task-001', status: statuses.shift() }),
  });
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(sleeps, [2000, 4000]);
  assert.equal(backoffDelayMs(4), 20000);
  clock = 0;
  await assert.rejects(() => pollUntilTerminal({
    timeoutMs: 3000, now: () => clock, sleep: async (ms) => { clock += ms; },
    fetchTask: async () => ({ id: 'hosted-task-001', status: 'queued' }),
  }), /Not resubmitting/);
  const failed = publicTask({ id: 'hosted-task-001', status: 'failed', error: { code: 'bad', message: `leak ${secret}` } });
  assert.equal(failed.terminal, true);
  assert.equal(failed.downloadReady, false);
  assert.equal(failed.errorMessage.includes(secret), false);
});

test('download follows an HTTPS redirect without sending the API key and keeps the URL out of the manifest', async () => {
  const dir = await fixture();
  const manifestPath = join(dir, 'outputs', 'clip', 'manifest.json');
  const outputDir = join(dir, 'outputs', 'clip');
  await submitNew({
    prompt: '下载成片。', firstFrame: png, manifestPath, maxPoints: 50, yes: true, apiKey: secret,
    fetchImpl: async (url) => String(url).endsWith('/point_usage_summary') ? jsonResponse(balance(80)) : jsonResponse({ task_id: 'hosted-task-003' }),
  });
  const seen = [];
  const saved = await downloadVideo({
    manifestPath, outputDir, apiKey: secret,
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), authorization: init.headers?.Authorization || null });
      if (String(url).includes('/query/video_generation/')) return jsonResponse({ task: { id: 'hosted-task-003', status: 'succeeded', content: { url: 'https://cdn.example/start.mp4' } } });
      if (String(url) === 'https://cdn.example/start.mp4') return new Response(null, { status: 302, headers: { location: 'https://cdn.example/final.mp4' } });
      assert.equal(init.headers, undefined);
      return new Response(mp4, { status: 200, headers: { 'content-type': 'video/mp4' } });
    },
  });
  assert.equal(seen.filter((item) => item.url.includes('cdn.example')).every((item) => item.authorization == null), true);
  assert.equal(saved.bytes, mp4.length);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(JSON.stringify(manifest).includes('cdn.example'), false);
  assert.equal(manifest.artifactPath, 'hosted-task-003.mp4');
  assert.equal((await readFile(saved.path)).equals(mp4), true);
  assert.throws(() => assertInsideOutputs(join(dir, 'deliverables')), /outputs directory/);
  assert.throws(() => assertDownloadUrl('http://evil.example/a.mp4'), /HTTPS/);
  await assert.rejects(() => downloadVideo({
    manifestPath, outputDir: join(dir, 'deliverables'), apiKey: secret,
    fetchImpl: async () => jsonResponse({ task: { id: 'hosted-task-003', status: 'running' } }),
  }), /not downloading/);
});

test('CLI estimate, budget refusal, and key handling stay local and redacted', async () => {
  const dir = await fixture();
  const help = call(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /768P/);
  const estimate = JSON.parse(call(['estimate']).stdout);
  assert.equal(estimate.resolution, '768P');
  assert.equal(estimate.estimatedPoints, 50);
  const warned = call(['estimate', '--resolution', '480P', '--duration', '16', '--count', '2']);
  assert.equal(warned.status, 0, warned.stderr);
  assert.match(warned.stderr, /hosted API only/);
  assert.match(warned.stderr, /4-15 seconds/);
  assert.equal(JSON.parse(warned.stdout).estimatedPoints, 160);
  refused(call(['estimate', '--resolution', '768p']));
  refused(call(['estimate', '--duration', '31']));
  const prompt = join(dir, 'prompt.txt');
  const frame = join(dir, 'frame.png');
  const manifest = join(dir, 'outputs', 'clip', 'manifest.json');
  await mkdir(dirname(manifest), { recursive: true });
  await writeFile(prompt, '本地拒绝，不连网。');
  await writeFile(frame, png);
  const common = ['submit', '--prompt-file', prompt, '--first-frame', frame, '--manifest', manifest, '--base-url', 'http://127.0.0.1:1'];
  const missingYes = refused(call([...common, '--max-points', '80']));
  assert.match(missingYes.stderr, /Pass --yes/);
  assert.equal(JSON.parse(missingYes.stdout).reason, 'missing-yes');
  await assert.rejects(() => stat(manifest), (error) => error.code === 'ENOENT');
  const over = refused(call([...common, '--max-points', '10', '--yes']));
  assert.match(over.stderr, /exceeds maxPoints/);
  assert.equal(over.stdout.includes('ECONNREFUSED') || over.stderr.includes('ECONNREFUSED'), false);
  const leaked = refused(call(['estimate', '--resolution', 'sk-ml-leaked-value']));
  assert.equal(leaked.stdout, '');
  assert.equal(leaked.stderr.includes('leaked-value'), false);
  const config = join(dir, 'budget.json');
  await writeFile(config, JSON.stringify({ maxPoints: 10, apiKey: 'sk-ml-config-secret' }));
  const hidden = refused(call([...common, '--config', config, '--yes'], { COMPSHARE_MINIMAX_API_KEY: secret }));
  assert.equal((hidden.stdout + hidden.stderr).includes('config-secret'), false);
  assert.equal((hidden.stdout + hidden.stderr).includes(secret), false);
  assert.match(hidden.stderr, /Refusing to read an API key/);
  await writeFile(join(dir, 'ceiling.json'), JSON.stringify({ maxPoints: 100 }));
  const tighter = refused(call([...common, '--config', join(dir, 'ceiling.json'), '--max-points', '10', '--yes']));
  assert.equal(JSON.parse(tighter.stdout).reason, 'over-budget');
  assert.equal(JSON.parse(tighter.stdout).maxPoints, 10);
});

test('CLI submit retries the saved key after a dropped response, then waits and downloads without posting again', async () => {
  const dir = await fixture();
  const prompt = join(dir, 'prompt.txt');
  const frame = join(dir, 'frame.png');
  const outputDir = join(dir, 'outputs', 'clip');
  const manifest = join(outputDir, 'manifest.json');
  await mkdir(outputDir, { recursive: true });
  await writeFile(prompt, '人物缓慢转头，树叶轻动。');
  await writeFile(frame, png);
  let posts = 0;
  let firstKey = '';
  let taskGets = 0;
  const server = createServer(async (req, res) => {
    const port = server.address().port;
    if (req.url.endsWith('/point_usage_summary')) {
      const payload = JSON.stringify(balance(500, 0));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(payload);
      return;
    }
    if (req.method === 'POST') {
      posts += 1;
      const key = req.headers['idempotency-key'];
      if (posts === 1) { firstKey = key; req.destroy(); return; }
      assert.equal(key, firstKey);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(body.resolution, '768P');
      assert.equal(body.ratio, '9:16');
      assert.equal(body.mute_audio, false);
      assert.match(body.content[1].image_url.url, /^data:image\/png;base64,/);
      const payload = JSON.stringify({ task_id: 'hosted-task-004' });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(payload);
      return;
    }
    if (req.method === 'GET' && req.url.includes('/query/video_generation/')) {
      taskGets += 1;
      const status = taskGets === 1 ? 'moderating' : 'succeeded';
      const task = { id: 'hosted-task-004', status, resolution: '768P', duration: 5, estimated_remaining_seconds: status === 'succeeded' ? 0 : 8 };
      if (status === 'succeeded') task.content = { url: `http://127.0.0.1:${port}/video.mp4` };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ task }));
      return;
    }
    if (req.url === '/video.mp4') {
      assert.equal(req.headers.authorization, undefined);
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.end(mp4);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = ['--base-url', `http://127.0.0.1:${port}`];
  try {
    const dropped = await run(['submit', '--prompt-file', prompt, '--first-frame', frame, '--manifest', manifest, '--max-points', '80', '--ratio', '9:16', '--yes', '--debug', ...base], { COMPSHARE_MINIMAX_API_KEY: secret });
    refused(dropped);
    assert.equal((dropped.stdout + dropped.stderr).includes(secret), false);
    assert.equal((dropped.stdout + dropped.stderr).includes(png.toString('base64')), false);
    assert.match(dropped.stderr, /Bearer \[redacted\]/);
    const prepared = JSON.parse(await readFile(manifest, 'utf8'));
    assert.equal(prepared.taskId, null);
    assert.equal(prepared.idempotencyKey, firstKey);
    const resumed = await run(['resume', '--manifest', manifest, '--prompt-file', prompt, '--first-frame', frame, ...base], { COMPSHARE_MINIMAX_API_KEY: secret });
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(JSON.parse(resumed.stdout).taskId, 'hosted-task-004');
    assert.equal((resumed.stdout + resumed.stderr).includes(secret), false);
    const status = await run(['resume', '--manifest', manifest, ...base], { COMPSHARE_MINIMAX_API_KEY: secret });
    assert.equal(status.status, 0, status.stderr);
    const viewed = JSON.parse(status.stdout);
    assert.equal(viewed.posted, false);
    assert.equal(viewed.status, 'moderating');
    const waited = await run(['wait', '--manifest', manifest, '--timeout', '5', ...base], { COMPSHARE_MINIMAX_API_KEY: secret });
    assert.equal(waited.status, 0, waited.stderr);
    assert.equal(JSON.parse(waited.stdout).status, 'succeeded');
    const downloaded = await run(['download', '--manifest', manifest, '--output-dir', outputDir, ...base], { COMPSHARE_MINIMAX_API_KEY: secret });
    assert.equal(downloaded.status, 0, downloaded.stderr);
    const file = JSON.parse(downloaded.stdout);
    assert.equal((await readFile(file.path)).equals(mp4), true);
    assert.equal(JSON.stringify(JSON.parse(await readFile(manifest, 'utf8'))).includes('video.mp4'), false);
    assert.equal(posts, 2);
    const points = JSON.parse((await run(['points', ...base], { COMPSHARE_MINIMAX_API_KEY: secret })).stdout);
    assert.equal(points.availablePoints, 500);
    assert.match(points.reservation, /released on failure or cancel/);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});
