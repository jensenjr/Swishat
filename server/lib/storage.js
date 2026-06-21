// Pluggable image storage. Driver chosen by STORAGE_DRIVER:
//   - "local" (default): writes to UPLOAD_DIR, served by the app at /uploads/*.
//     Use a Coolify persistent volume so files survive redeploys.
//   - "s3": any S3-compatible store (AWS S3, Cloudflare R2, MinIO). Zero extra
//     dependencies — requests are signed with SigV4 here, so `npm ci` is
//     unchanged whether or not you use S3.
//
// saveImage() returns a URL: a relative "/uploads/..." path for local (made
// absolute where needed, e.g. og:image), or the object's public URL for s3.

import { randomUUID, createHash, createHmac } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export function storageDriver() {
  return process.env.STORAGE_DRIVER === 's3' ? 's3' : 'local';
}

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function extForType(contentType) {
  return EXT_BY_TYPE[contentType] || null;
}

// ---- local driver ----

function uploadDir() {
  return process.env.UPLOAD_DIR || './uploads';
}

async function saveLocal(buffer, key, _contentType) {
  const full = join(uploadDir(), key);
  await mkdir(join(uploadDir(), 'covers'), { recursive: true });
  await writeFile(full, buffer);
  return `/uploads/${key}`;
}

async function removeLocal(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const key = url.slice('/uploads/'.length);
  if (key.includes('..')) return;
  await unlink(join(uploadDir(), key)).catch(() => {});
}

// ---- s3 driver (SigV4, path-style) ----

function s3Config() {
  return {
    endpoint: process.env.S3_ENDPOINT, // e.g. https://<acct>.r2.cloudflarestorage.com
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL, // public URL or CDN domain
  };
}

const sha256hex = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (key, d) => createHmac('sha256', key).update(d).digest();

function signingKey(secret, dateStamp, region, service) {
  return hmac(hmac(hmac(hmac('AWS4' + secret, dateStamp), region), service), 'aws4_request');
}

// Low-level SigV4-signed request to an S3-compatible endpoint (path-style).
// `path` is the full resource path, e.g. "/bucket" or "/bucket/key".
export async function s3SignedFetch({ method, path, body = Buffer.alloc(0), contentType }) {
  const cfg = s3Config();
  if (!cfg.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error('S3 storage is not configured');
  }
  const url = new URL(cfg.endpoint);
  const host = url.host;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);

  const headersToSign = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headersToSign['content-type'] = contentType;

  const sortedKeys = Object.keys(headersToSign).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headersToSign[k]}\n`).join('');
  const signedHeaders = sortedKeys.join(';');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join('\n');
  const signature = createHmac('sha256', signingKey(cfg.secretAccessKey, dateStamp, cfg.region, 's3'))
    .update(stringToSign)
    .digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: authorization,
  };
  if (contentType) headers['Content-Type'] = contentType;

  return fetch(`${url.origin}${path}`, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });
}

async function saveS3(buffer, key, contentType) {
  const cfg = s3Config();
  const res = await s3SignedFetch({
    method: 'PUT',
    path: `/${cfg.bucket}/${key}`,
    body: buffer,
    contentType,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`S3 upload failed (${res.status}): ${detail}`);
  }
  const base = cfg.publicBaseUrl || `${cfg.endpoint}/${cfg.bucket}`;
  return `${base.replace(/\/$/, '')}/${key}`;
}

async function removeS3(url) {
  const cfg = s3Config();
  if (!url) return;
  // Recover the key (everything after the bucket/base).
  const base = (cfg.publicBaseUrl || `${cfg.endpoint}/${cfg.bucket}`).replace(/\/$/, '');
  if (!url.startsWith(base + '/')) return;
  const key = url.slice(base.length + 1);
  await s3SignedFetch({ method: 'DELETE', path: `/${cfg.bucket}/${key}` }).catch(() => {});
}

// ---- public API ----

export async function saveImage(buffer, { contentType }) {
  const ext = extForType(contentType);
  if (!ext) throw new Error('Unsupported image type');
  const key = `covers/${randomUUID()}.${ext}`;
  return storageDriver() === 's3'
    ? saveS3(buffer, key, contentType)
    : saveLocal(buffer, key, contentType);
}

export async function removeImage(url) {
  return storageDriver() === 's3' ? removeS3(url) : removeLocal(url);
}
