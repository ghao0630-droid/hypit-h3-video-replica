#!/usr/bin/env node
// Hosted CompShare MiniMax H3 over HTTPS. Reads COMPSHARE_MINIMAX_API_KEY and never prints it.
import { createHash, randomUUID } from 'node:crypto';
import { open, link, unlink, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const DEFAULT_ORIGIN = 'https://cp.compshare.cn';
export const PRICING_DOC = 'https://www.compshare.cn/docs/minimax-h3/api/minimax-h3-video-api';
export const POINT_RATES = { '480P': 5, '768P': 10, '1080P': 19, '2K': 20, '4K': 22 };
export const DEFAULT_RESOLUTION = '768P';
export const DEFAULT_DURATION = 5;
export const DEFAULT_RATIO = '16:9';
export const RATIOS = ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
export const CLI_RESOLUTIONS = ['768P', '1080P', '2K'];
export const PACKAGE_POINTS = 1100;
export const PACKAGE_YUAN = 9.9;
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
export const MAX_REFERENCE_IMAGES = 9;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const MANIFEST_KIND = 'compshare-hosted-minimax-h3';
export const OBSERVED_480P_5S = { date: '2026-10-10', resolution: '480P', durationSeconds: 5, documentedPoints: 25, chargedPoints: 20 };

const usage = `Hosted CompShare MiniMax H3 (HTTPS, no SSH). Default resolution is 768P.
  points [--base-url URL]
  estimate [--resolution 768P] [--duration 5] [--count 1]
  submit --prompt-file PATH (--first-frame PATH | --reference-image PATH [--reference-image PATH...]) --manifest PATH
         (--max-points N | --config PATH) --yes [--spoken-language TEXT]
         [--resolution 768P] [--duration 5] [--ratio 16:9] [--mute] [--base-url URL] [--debug]
  status (--manifest PATH | --task-id ID) [--base-url URL]
  wait --manifest PATH [--timeout 900] [--base-url URL]
  download --manifest PATH --output-dir PROJECT/outputs/... [--base-url URL]
  resume --manifest PATH [--prompt-file PATH (--first-frame PATH | --reference-image PATH...)] [--spoken-language TEXT]
         [--base-url URL] [--debug]
--first-frame and --reference-image cannot be combined. At most 9 reference images.
The API key is COMPSHARE_MINIMAX_API_KEY and is never printed. Estimate is not an invoice.`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_ID = /^[A-Za-z0-9_-]{8,128}$/;

export function redactText(value) {
  return String(value)
    .replace(/Bearer\s+[^\s'"]+/gi, 'Bearer [redacted]')
    .replace(/sk-ml-[A-Za-z0-9._-]+/gi, 'sk-ml-[redacted]')
    .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:[redacted]');
}

export function debugView({ method, url, headers, body }) {
  const safeHeaders = {};
  for (const [name, header] of Object.entries(headers || {})) {
    safeHeaders[name] = name.toLowerCase() === 'authorization' ? 'Bearer [redacted]' : redactText(header);
  }
  let safeBody = body;
  if (body && Array.isArray(body.content)) {
    safeBody = {
      ...body,
      content: body.content.map((item) => {
        const dataUrl = item?.image_url?.url;
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
          return { ...item, image_url: { url: `data:[redacted length=${dataUrl.length}]` } };
        }
        return item;
      }),
    };
  }
  return { method, url: redactText(url), headers: safeHeaders, body: safeBody };
}

export function formatDebug(info) {
  return redactText(JSON.stringify(debugView(info)));
}

export function yuanFromPoints(points) {
  if (!Number.isSafeInteger(points) || points < 0) throw new Error('Points must be a non-negative integer.');
  return Number((points * 9 / 1000).toFixed(3));
}

export function cliWarnings(resolution, duration) {
  const warnings = [];
  if (!CLI_RESOLUTIONS.includes(resolution)) warnings.push(`compshare-cli 0.4.4 minimax allows only 768P, 1080P, and 2K; ${resolution} is accepted by the hosted API only.`);
  if (duration > 15) warnings.push('compshare-cli 0.4.4 minimax allows only 4-15 seconds; the hosted API allows 4-30.');
  return warnings;
}

export function assertDuration(duration) {
  if (!Number.isInteger(duration) || duration < 4 || duration > 30) throw new Error('duration must be an integer from 4 to 30 seconds.');
  return duration;
}

export function assertCount(count) {
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('count must be an integer from 1 to 100.');
  return count;
}

export function assertResolution(resolution) {
  if (!Object.hasOwn(POINT_RATES, resolution)) throw new Error('resolution must be one of 480P, 768P, 1080P, 2K, 4K (case-sensitive). Unknown values are not coerced.');
  return resolution;
}

export function assertRatio(ratio) {
  if (!RATIOS.includes(ratio)) throw new Error(`ratio must be one of ${RATIOS.join(', ')}.`);
  return ratio;
}

export function estimateCost({ resolution = DEFAULT_RESOLUTION, duration = DEFAULT_DURATION, count = 1 } = {}) {
  assertResolution(resolution);
  assertDuration(duration);
  assertCount(count);
  const pointsPerSecond = POINT_RATES[resolution];
  const estimatedPoints = pointsPerSecond * duration * count;
  if (!Number.isSafeInteger(estimatedPoints)) throw new Error('Estimate exceeds reliable integer precision.');
  return {
    resolution,
    durationSeconds: duration,
    count,
    pointsPerSecond,
    estimatedPoints,
    estimatedYuan: yuanFromPoints(estimatedPoints),
    packagePoints: PACKAGE_POINTS,
    packageYuan: PACKAGE_YUAN,
    yuanPerPoint: 0.009,
    pricingDoc: PRICING_DOC,
    isSettledInvoice: false,
    cliWarnings: cliWarnings(resolution, duration),
    productionCheck: { ...OBSERVED_480P_5S },
  };
}

export function detectImageMime(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error('Image must be a file buffer.');
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function toDataUrl(bytes, { maxBytes = MAX_IMAGE_BYTES } = {}) {
  const mime = detectImageMime(bytes);
  if (!mime) throw new Error('Image must be PNG, JPEG, or WebP.');
  if (bytes.length > maxBytes) throw new Error(`Image exceeds ${maxBytes} bytes.`);
  const url = `data:${mime};base64,${bytes.toString('base64')}`;
  if (Buffer.byteLength(url) > 60 * 1024 * 1024) throw new Error('Data URL exceeds the request body budget.');
  return { url, mime, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}

export function assertTaskId(value) {
  if (typeof value !== 'string' || !TASK_ID.test(value)) throw new Error('Unexpected task id.');
  return value;
}

export function canonicalOrigin(value = DEFAULT_ORIGIN) {
  const url = new URL(value);
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Base URL must be an origin without credentials, a path, or a query.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Hosted API base URL must be HTTPS. Loopback HTTP is only for tests.');
  return url.origin;
}

export function assertDownloadUrl(value) {
  const url = new URL(value);
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  if (url.username || url.password) throw new Error('Video URL must not include credentials.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Video URL must be HTTPS.');
  return url.toString();
}

export function assertInsideOutputs(dir) {
  const resolved = resolve(dir);
  if (!resolved.split(sep).includes('outputs')) throw new Error('Refusing to save video outside a project outputs directory.');
  return resolved;
}

export function backoffDelayMs(attempt) {
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error('Backoff attempt must be a non-negative integer.');
  return Math.min(20000, 2000 * (2 ** Math.min(attempt, 10)));
}

export function isTerminalStatus(status) {
  return ['succeeded', 'failed', 'cancelled'].includes(String(status || '').toLowerCase());
}

export function parseBalance(body) {
  const fields = ['total_points', 'reserved_points', 'available_points'];
  const values = Object.fromEntries(fields.map((name) => [name, body?.[name]]));
  for (const name of fields) {
    if (!Number.isInteger(values[name]) || values[name] < 0) throw new Error(`Balance ${name} is not a non-negative integer.`);
  }
  if (values.available_points + values.reserved_points !== values.total_points) throw new Error('Balance fields are inconsistent.');
  return {
    totalPoints: values.total_points,
    reservedPoints: values.reserved_points,
    availablePoints: values.available_points,
    reservation: 'Points are reserved on submit and released on failure or cancel.',
    isSettledInvoice: false,
  };
}

export function publicTask(task) {
  if (!task || typeof task.id !== 'string' || typeof task.status !== 'string') throw new Error('Task response is missing id or status.');
  assertTaskId(task.id);
  const status = task.status;
  return {
    taskId: task.id,
    status,
    resolution: task.resolution ?? null,
    durationSeconds: task.duration ?? null,
    estimatedRemainingSeconds: task.estimated_remaining_seconds ?? null,
    terminal: isTerminalStatus(status),
    downloadReady: status.toLowerCase() === 'succeeded' && typeof task.content?.url === 'string',
    errorCode: task.error?.code ?? null,
    errorMessage: task.error?.message == null ? null : redactText(task.error.message).slice(0, 300),
  };
}

export function assertSpokenLanguage(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value !== value.trim() || /[\r\n\u0000]/.test(value) || [...value].length > 40) {
    throw new Error('--spoken-language must be one line of at most 40 characters.');
  }
  return value;
}

export function applySpokenLanguage(prompt, spokenLanguage) {
  const language = assertSpokenLanguage(spokenLanguage);
  if (!language) return prompt;
  return `${prompt}\n\n对白只使用${language}，各段保持同一种口语语言，不要中途换语言。`;
}

export function prepareImages({ firstFrame = null, referenceImages = [] } = {}) {
  if (!Array.isArray(referenceImages)) throw new Error('referenceImages must be an array.');
  const hasFirst = firstFrame != null;
  if (hasFirst && referenceImages.length > 0) throw new Error('Use either --first-frame or --reference-image, not both. The hosted API does not allow first_frame and reference_image in the same task.');
  if (!hasFirst && referenceImages.length === 0) throw new Error('Pass --first-frame, or 1 to 9 --reference-image files.');
  if (referenceImages.length > MAX_REFERENCE_IMAGES) throw new Error('At most 9 --reference-image files are allowed.');
  if (hasFirst) return { imageMode: 'first_frame', frame: toDataUrl(firstFrame), references: [] };
  const references = referenceImages.map((bytes, index) => {
    try { return toDataUrl(bytes); }
    catch (error) { throw new Error(`Reference image ${index + 1}: ${error.message}`); }
  });
  const budget = references.reduce((sum, item) => sum + Buffer.byteLength(item.url), 0);
  if (budget > 60 * 1024 * 1024) throw new Error('Reference images exceed the request body budget.');
  return { imageMode: 'reference_image', frame: null, references };
}

export function buildCreateBody({ prompt, dataUrl, firstFrameUrl = dataUrl, referenceUrls = [], resolution, duration, ratio, muteAudio }) {
  const references = referenceUrls ?? [];
  if (firstFrameUrl && references.length > 0) throw new Error('Use either --first-frame or --reference-image, not both. The hosted API does not allow first_frame and reference_image in the same task.');
  const content = [{ type: 'text', text: prompt }];
  if (firstFrameUrl) content.push({ type: 'image_url', image_url: { url: firstFrameUrl }, role: 'first_frame' });
  else if (references.length > 0) {
    if (references.length > MAX_REFERENCE_IMAGES) throw new Error('At most 9 --reference-image files are allowed.');
    for (const url of references) content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
  } else throw new Error('Pass --first-frame, or 1 to 9 --reference-image files.');
  return { model: 'MiniMax-H3', content, resolution, duration, ratio, mute_audio: muteAudio };
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireKey(key) {
  if (typeof key !== 'string' || !key.startsWith('sk-ml-') || key.length < 8 || /\s/.test(key)) throw new Error('Set COMPSHARE_MINIMAX_API_KEY to a sk-ml- key. The value is not printed.');
  return key;
}

function responseError(body, text, status) {
  const raw = body?.error?.message || body?.message || text.slice(0, 300);
  const message = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return new Error(`CompShare API ${status}: ${redactText(message).slice(0, 300)}`);
}

async function requestJson({ origin, path, method, apiKey, body, idempotencyKey, fetchImpl, debugLog }) {
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error('Refusing to call a different origin.');
  const headers = { Accept: 'application/json', Authorization: `Bearer ${requireKey(apiKey)}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  debugLog(formatDebug({ method, url: url.toString(), headers, body }));
  let response;
  try {
    response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    throw new Error(`CompShare request failed: ${redactText(error?.message || error)}`);
  }
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error('Response is too large.');
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!response.ok) throw responseError(parsed, text, response.status);
  if (!parsed || typeof parsed !== 'object') throw new Error('CompShare API returned an empty response.');
  return parsed;
}

export async function queryPoints({ origin = DEFAULT_ORIGIN, apiKey, fetchImpl = globalThis.fetch, debugLog = () => {} }) {
  const body = await requestJson({ origin: canonicalOrigin(origin), path: '/minimax/v2/query/point_usage_summary', method: 'GET', apiKey, fetchImpl, debugLog });
  return parseBalance(body);
}

async function fetchTaskRaw({ origin, taskId, apiKey, fetchImpl, debugLog }) {
  const body = await requestJson({ origin, path: `/minimax/v2/query/video_generation/${assertTaskId(taskId)}`, method: 'GET', apiKey, fetchImpl, debugLog });
  if (!body.task) throw new Error('Task response has no task object.');
  return body.task;
}

async function syncDirectory(dir) {
  let handle;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch { /* Directory fsync is best-effort. */ } finally { await handle?.close(); }
}

async function exclusiveBytes(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.chmod(0o600);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(tmp).catch(() => {});
    throw error;
  }
  await handle.close();
  try { await link(tmp, path); }
  catch (error) {
    await unlink(tmp).catch(() => {});
    if (error.code === 'EEXIST') throw new Error(`Refusing to overwrite ${path}`);
    throw error;
  }
  await unlink(tmp);
  await syncDirectory(dirname(path));
}

async function writeManifest(path, value, { exclusive }) {
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  if (!exclusive) {
    const tmp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
    const handle = await open(tmp, 'wx', 0o600);
    try {
      await handle.writeFile(payload);
      await handle.chmod(0o600);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(tmp).catch(() => {});
      throw error;
    }
    await handle.close();
    await renameSafe(tmp, path);
    await syncDirectory(dirname(path));
    return;
  }
  await exclusiveBytes(path, payload);
}

async function renameSafe(tmp, path) {
  try { await rename(tmp, path); }
  catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

export async function loadManifest(path) {
  let value;
  try { value = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error instanceof SyntaxError) throw new Error('Manifest is not valid JSON.'); throw error; }
  if (value?.kind !== MANIFEST_KIND || value.manifestVersion !== 1) throw new Error('Not a hosted H3 manifest.');
  if (typeof value.idempotencyKey !== 'string' || !UUID.test(value.idempotencyKey)) throw new Error('Manifest idempotency key is invalid.');
  if (!(value.taskId == null)) assertTaskId(value.taskId);
  if (value.confirmed !== true) throw new Error('Manifest is not a confirmed submission.');
  if (!Number.isInteger(value.estimatedPoints) || !Number.isInteger(value.maxPoints)) throw new Error('Manifest budget fields are invalid.');
  canonicalOrigin(value.origin);
  assertResolution(value.resolution);
  assertDuration(value.duration);
  assertRatio(value.ratio);
  if (typeof value.muteAudio !== 'boolean') throw new Error('Manifest mute flag is invalid.');
  if (typeof value.promptSha256 !== 'string') throw new Error('Manifest input hashes are missing.');
  if (value.spokenLanguage === undefined) value.spokenLanguage = null;
  assertSpokenLanguage(value.spokenLanguage);
  if (value.referenceImages == null) value.referenceImages = [];
  if (!Array.isArray(value.referenceImages)) throw new Error('Manifest reference image hashes are invalid.');
  if (value.imageMode == null) {
    if (typeof value.firstFrameSha256 !== 'string') throw new Error('Manifest input hashes are missing.');
    value.imageMode = 'first_frame';
  }
  if (value.imageMode === 'first_frame') {
    if (typeof value.firstFrameSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.firstFrameSha256)) throw new Error('Manifest input hashes are missing.');
    if (value.referenceImages.length !== 0) throw new Error('Manifest mixes first_frame and reference_image.');
  } else if (value.imageMode === 'reference_image') {
    if (value.firstFrameSha256 != null) throw new Error('Manifest mixes first_frame and reference_image.');
    if (value.referenceImages.length < 1 || value.referenceImages.length > MAX_REFERENCE_IMAGES) throw new Error('Manifest reference image hashes are invalid.');
    for (const item of value.referenceImages) {
      if (!item || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Manifest reference image hashes are invalid.');
    }
  } else throw new Error('Manifest image mode is invalid.');
  return value;
}

function manifestRecord({ prompt, images, resolution, duration, ratio, muteAudio, spokenLanguage, estimate, maxPoints, origin }) {
  return {
    manifestVersion: 1,
    kind: MANIFEST_KIND,
    createdAt: new Date().toISOString(),
    origin,
    model: 'MiniMax-H3',
    idempotencyKey: randomUUID(),
    taskId: null,
    phase: 'prepared',
    remoteStatus: null,
    resolution,
    duration,
    ratio,
    muteAudio,
    spokenLanguage,
    imageMode: images.imageMode,
    promptSha256: sha256Text(prompt),
    firstFrameSha256: images.frame?.sha256 ?? null,
    firstFrameMime: images.frame?.mime ?? null,
    referenceImages: images.references.map((item) => ({ sha256: item.sha256, mime: item.mime })),
    estimatedPoints: estimate.estimatedPoints,
    estimatedYuan: estimate.estimatedYuan,
    maxPoints,
    confirmed: true,
    artifactPath: null,
    cliWarnings: estimate.cliWarnings,
  };
}

async function finishSubmit({ manifestPath, manifest, prompt, frame, references, apiKey, fetchImpl, debugLog }) {
  const balance = await queryPoints({ origin: manifest.origin, apiKey, fetchImpl, debugLog });
  if (balance.availablePoints < manifest.estimatedPoints) {
    manifest.remoteStatus = 'blocked-insufficient-points';
    await writeManifest(manifestPath, manifest, { exclusive: false });
    throw new Error(`Available points ${balance.availablePoints} are below the estimate ${manifest.estimatedPoints}. No video task was submitted.`);
  }
  const body = buildCreateBody({
    prompt,
    firstFrameUrl: frame?.url,
    referenceUrls: (references ?? []).map((item) => item.url),
    resolution: manifest.resolution,
    duration: manifest.duration,
    ratio: manifest.ratio,
    muteAudio: manifest.muteAudio,
  });
  const created = await requestJson({
    origin: manifest.origin, path: '/minimax/v2/video_generation', method: 'POST', apiKey, body,
    idempotencyKey: manifest.idempotencyKey, fetchImpl, debugLog,
  });
  if (typeof created.task_id !== 'string') throw new Error('Create response has no task_id. Resume will reuse the saved idempotency key.');
  manifest.taskId = assertTaskId(created.task_id);
  manifest.phase = 'submitted';
  manifest.remoteStatus = 'submitted';
  await writeManifest(manifestPath, manifest, { exclusive: false });
  return {
    submitted: true,
    posted: true,
    taskId: manifest.taskId,
    idempotencyKey: manifest.idempotencyKey,
    manifest: manifestPath,
    estimatedPoints: manifest.estimatedPoints,
    estimatedYuan: manifest.estimatedYuan,
    maxPoints: manifest.maxPoints,
    resolution: manifest.resolution,
    durationSeconds: manifest.duration,
    imageMode: manifest.imageMode,
    referenceCount: manifest.referenceImages.length,
    spokenLanguage: manifest.spokenLanguage,
    availablePointsBeforeSubmit: balance.availablePoints,
    cliWarnings: manifest.cliWarnings,
    isSettledInvoice: false,
  };
}

export async function submitNew({
  prompt, firstFrame = null, referenceImages = [], spokenLanguage = null, manifestPath, maxPoints, yes = false, resolution = DEFAULT_RESOLUTION,
  duration = DEFAULT_DURATION, ratio = DEFAULT_RATIO, muteAudio = false, origin = DEFAULT_ORIGIN,
  apiKey, fetchImpl = globalThis.fetch, debugLog = () => {},
}) {
  if (typeof prompt !== 'string' || prompt.trim() === '') throw new Error('Prompt file is empty.');
  const language = assertSpokenLanguage(spokenLanguage);
  const text = applySpokenLanguage(prompt.trim(), language);
  if ([...text].length > 7000) throw new Error('Prompt exceeds 7000 characters.');
  if (typeof manifestPath !== 'string' || !manifestPath.endsWith('.json')) throw new Error('Manifest path must end with .json.');
  if (!Number.isInteger(maxPoints) || maxPoints < 0) throw new Error('maxPoints must be a non-negative integer.');
  if (typeof muteAudio !== 'boolean') throw new Error('mute must be boolean.');
  const images = prepareImages({ firstFrame, referenceImages });
  const selectedResolution = assertResolution(resolution);
  const selectedDuration = assertDuration(duration);
  const selectedRatio = assertRatio(ratio);
  const estimate = estimateCost({ resolution: selectedResolution, duration: selectedDuration, count: 1 });
  if (estimate.estimatedPoints > maxPoints) return { submitted: false, reason: 'over-budget', estimate, maxPoints };
  if (!yes) return { submitted: false, reason: 'missing-yes', estimate };
  requireKey(apiKey);
  const manifest = manifestRecord({
    prompt: text, images, resolution: selectedResolution, duration: selectedDuration, ratio: selectedRatio,
    muteAudio, spokenLanguage: language, estimate, maxPoints, origin: canonicalOrigin(origin),
  });
  // The idempotency key and taskId field are durable before any request, so a crash cannot mint a second key.
  await writeManifest(manifestPath, manifest, { exclusive: true });
  try {
    return await finishSubmit({ manifestPath, manifest, prompt: text, frame: images.frame, references: images.references, apiKey, fetchImpl, debugLog });
  } catch (error) {
    throw new Error(`${redactText(error.message)} Manifest kept for resume.`);
  }
}

function sameInputs(manifest, prompt, firstFrame, referenceImages, spokenLanguage) {
  const language = assertSpokenLanguage(spokenLanguage);
  if (language !== manifest.spokenLanguage) throw new Error('Spoken language does not match the manifest. Refusing to reuse the idempotency key.');
  const text = applySpokenLanguage(prompt.trim(), manifest.spokenLanguage);
  if (sha256Text(text) !== manifest.promptSha256) throw new Error('Prompt does not match the manifest. Refusing to reuse the idempotency key.');
  const images = prepareImages({ firstFrame: firstFrame ?? null, referenceImages: referenceImages ?? [] });
  if (images.imageMode !== manifest.imageMode) throw new Error('Image mode does not match the manifest. Refusing to reuse the idempotency key.');
  if (images.imageMode === 'first_frame') {
    if (images.frame.sha256 !== manifest.firstFrameSha256 || images.frame.mime !== manifest.firstFrameMime) {
      throw new Error('First frame does not match the manifest. Refusing to reuse the idempotency key.');
    }
  } else {
    if (images.references.length !== manifest.referenceImages.length) throw new Error('Reference images do not match the manifest. Refusing to reuse the idempotency key.');
    images.references.forEach((item, index) => {
      const saved = manifest.referenceImages[index];
      if (item.sha256 !== saved.sha256 || item.mime !== saved.mime) throw new Error(`Reference image ${index + 1} does not match the manifest. Refusing to reuse the idempotency key.`);
    });
  }
  return { text, frame: images.frame, references: images.references };
}

export async function resumeSubmission({ manifestPath, prompt, firstFrame = null, referenceImages = [], spokenLanguage = null, baseUrl, apiKey, fetchImpl = globalThis.fetch, debugLog = () => {} }) {
  const manifest = await loadManifest(manifestPath);
  if (baseUrl != null && canonicalOrigin(baseUrl) !== manifest.origin) throw new Error('Base URL does not match the manifest.');
  if (manifest.taskId) {
    const raw = await fetchTaskRaw({ origin: manifest.origin, taskId: manifest.taskId, apiKey, fetchImpl, debugLog });
    manifest.remoteStatus = raw.status;
    await writeManifest(manifestPath, manifest, { exclusive: false });
    return { submitted: false, posted: false, manifest: manifestPath, ...publicTask(raw) };
  }
  if (typeof prompt !== 'string') throw new Error(manifest.imageMode === 'reference_image' ? 'Resume without a task id needs the original prompt and the same reference images.' : 'Resume without a task id needs the original prompt and first frame.');
  const fresh = estimateCost({ resolution: manifest.resolution, duration: manifest.duration, count: 1 });
  if (fresh.estimatedPoints !== manifest.estimatedPoints) throw new Error('Price table no longer matches the manifest. Refusing to submit.');
  if (fresh.estimatedPoints > manifest.maxPoints) throw new Error('Estimate exceeds the saved maxPoints. Refusing to submit.');
  // Check hashes before the idempotency key is sent again.
  const inputs = sameInputs(manifest, prompt, firstFrame, referenceImages, spokenLanguage);
  try {
    return await finishSubmit({ manifestPath, manifest, prompt: inputs.text, frame: inputs.frame, references: inputs.references, apiKey, fetchImpl, debugLog });
  } catch (error) {
    throw new Error(`${redactText(error.message)} Manifest kept for resume.`);
  }
}

export async function queryStatus({ manifestPath, taskId, baseUrl, apiKey, fetchImpl = globalThis.fetch, debugLog = () => {} }) {
  if (!manifestPath && !taskId) throw new Error('Pass --manifest or --task-id.');
  if (manifestPath) {
    const manifest = await loadManifest(manifestPath);
    if (!manifest.taskId) throw new Error('Task has not been submitted. Use resume; do not create another manifest.');
    if (baseUrl != null && canonicalOrigin(baseUrl) !== manifest.origin) throw new Error('Base URL does not match the manifest.');
    const raw = await fetchTaskRaw({ origin: manifest.origin, taskId: manifest.taskId, apiKey, fetchImpl, debugLog });
    manifest.remoteStatus = raw.status;
    await writeManifest(manifestPath, manifest, { exclusive: false });
    return { manifest: manifestPath, posted: false, ...publicTask(raw) };
  }
  const raw = await fetchTaskRaw({ origin: canonicalOrigin(baseUrl), taskId: assertTaskId(taskId), apiKey, fetchImpl, debugLog });
  return { posted: false, ...publicTask(raw) };
}

export async function pollUntilTerminal({ fetchTask, timeoutMs, sleep, now = Date.now }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('timeout must be a positive integer.');
  const started = now();
  let attempt = 0;
  let last = null;
  for (;;) {
    last = await fetchTask();
    if (isTerminalStatus(last.status)) return last;
    const delay = backoffDelayMs(attempt);
    if (now() - started + delay > timeoutMs) throw new Error(`Timed out waiting at status ${last.status}. Not resubmitting.`);
    await sleep(delay);
    attempt += 1;
  }
}

export async function waitForManifest({ manifestPath, timeoutMs = 900000, baseUrl, apiKey, fetchImpl = globalThis.fetch, debugLog = () => {}, sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)), now = Date.now }) {
  const manifest = await loadManifest(manifestPath);
  if (!manifest.taskId) throw new Error('Task has not been submitted. Use resume; do not create another manifest.');
  if (baseUrl != null && canonicalOrigin(baseUrl) !== manifest.origin) throw new Error('Base URL does not match the manifest.');
  const raw = await pollUntilTerminal({
    timeoutMs,
    sleep,
    now,
    fetchTask: () => fetchTaskRaw({ origin: manifest.origin, taskId: manifest.taskId, apiKey, fetchImpl, debugLog }),
  });
  manifest.remoteStatus = raw.status;
  await writeManifest(manifestPath, manifest, { exclusive: false });
  return { manifest: manifestPath, posted: false, ...publicTask(raw) };
}

export async function fetchVideoBytes(url, fetchImpl) {
  let current = assertDownloadUrl(url);
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetchImpl(current, { method: 'GET', redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Video redirect is missing a location.');
      current = assertDownloadUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Video download failed with status ${response.status}.`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_VIDEO_BYTES) throw new Error('Video exceeds the download size limit.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_VIDEO_BYTES) throw new Error('Video exceeds the download size limit.');
    if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('Download is not an MP4.');
    return bytes;
  }
  throw new Error('Video download exceeded redirect limit.');
}

export async function downloadVideo({ manifestPath, outputDir, baseUrl, apiKey, fetchImpl = globalThis.fetch, debugLog = () => {} }) {
  const manifest = await loadManifest(manifestPath);
  if (!manifest.taskId) throw new Error('Task has not been submitted. Use resume before downloading.');
  if (baseUrl != null && canonicalOrigin(baseUrl) !== manifest.origin) throw new Error('Base URL does not match the manifest.');
  const raw = await fetchTaskRaw({ origin: manifest.origin, taskId: manifest.taskId, apiKey, fetchImpl, debugLog });
  if (String(raw.status).toLowerCase() !== 'succeeded') throw new Error(`Task is ${raw.status}; not downloading.`);
  if (typeof raw.content?.url !== 'string') throw new Error('Succeeded task has no video URL.');
  const dir = assertInsideOutputs(outputDir);
  await mkdir(dir, { recursive: true });
  const target = join(dir, `${manifest.taskId}.mp4`);
  const bytes = await fetchVideoBytes(raw.content.url, fetchImpl);
  try { await exclusiveBytes(target, bytes); }
  catch (error) {
    if (!String(error.message).startsWith('Refusing to overwrite')) throw error;
    const existing = await readFile(target);
    if (!existing.equals(bytes)) throw error;
  }
  manifest.remoteStatus = 'succeeded';
  manifest.artifactPath = relative(dirname(resolve(manifestPath)), target);
  await writeManifest(manifestPath, manifest, { exclusive: false });
  return { taskId: manifest.taskId, path: target, bytes: bytes.length, artifactPath: manifest.artifactPath, posted: false };
}

export async function loadMaxPoints(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 2 || info.size > 65536) throw new Error('Config must be a JSON file under 64 KiB.');
  let value;
  try { value = JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new Error('Config is not valid JSON.'); }
  const banned = ['apiKey', 'api_key', 'authorization', 'Authorization', 'token', 'COMPSHARE_MINIMAX_API_KEY'];
  if (value && typeof value === 'object' && banned.some((key) => Object.hasOwn(value, key))) throw new Error('Refusing to read an API key from config. Use COMPSHARE_MINIMAX_API_KEY.');
  if (!value || !Number.isInteger(value.maxPoints) || value.maxPoints < 0) throw new Error('config.maxPoints must be a non-negative integer.');
  return value.maxPoints;
}

function printJson(value) {
  console.log(redactText(JSON.stringify(value, null, 2)));
}

function optionalInteger(value, name) {
  if (value == null) return undefined;
  if (!/^[0-9]+$/.test(value)) throw new Error(`${name} must be an integer.`);
  return Number(value);
}

async function readPrompt(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > 65536) throw new Error('Prompt file must be a non-empty text file under 64 KiB.');
  return readFile(path, 'utf8');
}

async function readImage(path, label) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1) throw new Error(`${label} is missing.`);
  if (info.size > MAX_IMAGE_BYTES) throw new Error(`${label} exceeds 30 MiB.`);
  return readFile(path);
}

function optionList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function referencePaths(values) {
  const paths = optionList(values['reference-image']);
  if (values['first-frame'] && paths.length > 0) throw new Error('Use either --first-frame or --reference-image, not both. The hosted API does not allow first_frame and reference_image in the same task.');
  if (paths.length > MAX_REFERENCE_IMAGES) throw new Error('At most 9 --reference-image files are allowed.');
  return paths;
}

function spokenLanguageFlag(value) {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) throw new Error('--spoken-language must be one line of at most 40 characters.');
  return assertSpokenLanguage(trimmed);
}

function keyFromEnv() {
  return requireKey(process.env.COMPSHARE_MINIMAX_API_KEY);
}

async function resolveBudget(flag, configPath) {
  const fromFlag = optionalInteger(flag, '--max-points');
  const fromConfig = configPath ? await loadMaxPoints(configPath) : undefined;
  if (fromFlag == null && fromConfig == null) throw new Error('Pass --max-points or --config with maxPoints.');
  if (fromFlag != null && fromConfig != null) return Math.min(fromFlag, fromConfig);
  return fromFlag ?? fromConfig;
}

async function main() {
  if (process.argv.some((arg) => /sk-ml-/i.test(arg))) throw new Error('Do not pass the API key on the command line.');
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' },
    resolution: { type: 'string' }, duration: { type: 'string' }, count: { type: 'string' }, ratio: { type: 'string' },
    'prompt-file': { type: 'string' }, 'first-frame': { type: 'string' }, 'reference-image': { type: 'string', multiple: true },
    'spoken-language': { type: 'string' }, manifest: { type: 'string' },
    'max-points': { type: 'string' }, config: { type: 'string' }, yes: { type: 'boolean' }, mute: { type: 'boolean' },
    'base-url': { type: 'string' }, debug: { type: 'boolean' }, 'task-id': { type: 'string' }, 'output-dir': { type: 'string' },
    timeout: { type: 'string' },
  } });
  if (values.help) { console.log(usage); return; }
  const [command] = positionals;
  if (positionals.length !== 1) throw new Error(usage);
  const debugLog = values.debug ? (line) => console.error(line) : () => {};
  const network = { fetchImpl: globalThis.fetch, debugLog, origin: values['base-url'] || DEFAULT_ORIGIN };

  if (command === 'estimate') {
    const estimate = estimateCost({
      resolution: values.resolution || DEFAULT_RESOLUTION,
      duration: optionalInteger(values.duration, '--duration') ?? DEFAULT_DURATION,
      count: optionalInteger(values.count, '--count') ?? 1,
    });
    if (estimate.cliWarnings.length) console.error(estimate.cliWarnings.join('\n'));
    printJson(estimate);
    return;
  }

  if (command === 'submit') {
    if (values.count != null) throw new Error('submit creates one task. Use estimate --count for a batch total.');
    const references = referencePaths(values);
    const result = await submitNew({
      prompt: await readPrompt(values['prompt-file']),
      firstFrame: values['first-frame'] ? await readImage(values['first-frame'], 'First frame') : null,
      referenceImages: await Promise.all(references.map((path) => readImage(path, 'Reference image'))),
      spokenLanguage: spokenLanguageFlag(values['spoken-language']),
      manifestPath: values.manifest,
      maxPoints: await resolveBudget(values['max-points'], values.config),
      yes: values.yes === true,
      resolution: values.resolution || DEFAULT_RESOLUTION,
      duration: optionalInteger(values.duration, '--duration') ?? DEFAULT_DURATION,
      ratio: values.ratio || DEFAULT_RATIO,
      muteAudio: values.mute === true,
      apiKey: process.env.COMPSHARE_MINIMAX_API_KEY,
      ...network,
    });
    if (result.estimate?.cliWarnings?.length || result.cliWarnings?.length) console.error((result.cliWarnings || result.estimate.cliWarnings).join('\n'));
    printJson(result);
    if (!result.submitted) throw new Error(result.reason === 'over-budget' ? 'Estimate exceeds maxPoints. No task was submitted.' : 'Pass --yes to submit. No task was submitted.');
    return;
  }

  network.apiKey = keyFromEnv();
  if (command === 'points') {
    printJson(await queryPoints(network));
    return;
  }
  if (command === 'status') {
    printJson(await queryStatus({ manifestPath: values.manifest, taskId: values['task-id'], baseUrl: values['base-url'], ...network }));
    return;
  }
  if (command === 'wait') {
    printJson(await waitForManifest({ manifestPath: values.manifest, timeoutMs: (optionalInteger(values.timeout, '--timeout') ?? 900) * 1000, baseUrl: values['base-url'], ...network }));
    return;
  }
  if (command === 'download') {
    if (!values['output-dir']) throw new Error('Pass --output-dir inside the project outputs directory.');
    printJson(await downloadVideo({ manifestPath: values.manifest, outputDir: values['output-dir'], baseUrl: values['base-url'], ...network }));
    return;
  }
  if (command === 'resume') {
    const paths = referencePaths(values);
    const prompt = values['prompt-file'] ? await readPrompt(values['prompt-file']) : undefined;
    const firstFrame = values['first-frame'] ? await readImage(values['first-frame'], 'First frame') : null;
    const referenceImages = await Promise.all(paths.map((path) => readImage(path, 'Reference image')));
    printJson(await resumeSubmission({
      manifestPath: values.manifest, prompt, firstFrame, referenceImages,
      spokenLanguage: spokenLanguageFlag(values['spoken-language']), baseUrl: values['base-url'], ...network,
    }));
    return;
  }
  throw new Error(usage);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(redactText(error?.message || error)); process.exitCode = 1; });
}
