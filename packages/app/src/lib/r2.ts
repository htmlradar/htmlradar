// Cloudflare R2 client, accessed via the S3-compatible API.
// Why S3 SDK and not the R2 binding? The binding is only available inside
// Cloudflare Workers (the proxy package uses it directly). The Next.js app
// runs on Vercel and can't reach R2 except via HTTPS — the S3 SDK + R2's
// S3-compatible endpoint is the documented path.
//
// We never sign URLs for client-direct uploads — uploads always go through
// our Server Action, which means we can enforce the 10-doc cap and the
// 30 MB body size limit in one place.

import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const accessKeyId = process.env['CLOUDFLARE_R2_ACCESS_KEY_ID']!;
const secretAccessKey = process.env['CLOUDFLARE_R2_SECRET_ACCESS_KEY']!;

// Endpoint resolution — supports two env var shapes so users who pasted
// the full endpoint URL (`https://<acct>.r2.cloudflarestorage.com`) and
// users who pasted just the account ID both work:
//   1. CLOUDFLARE_R2_ENDPOINT — full URL preferred
//   2. CLOUDFLARE_ACCOUNT_ID — we construct the URL ourselves
// Strips stray protocol prefixes / paths the user may have included by
// mistake (Cloudflare's UI is inconsistent about which form it shows).
const endpoint = resolveEndpoint();

function resolveEndpoint(): string {
  const explicit = process.env['CLOUDFLARE_R2_ENDPOINT'];
  if (explicit) return explicit.replace(/\/+$/, '');

  const raw = process.env['CLOUDFLARE_ACCOUNT_ID'];
  if (!raw) {
    throw new Error(
      'R2 not configured: set CLOUDFLARE_R2_ENDPOINT (full URL) or CLOUDFLARE_ACCOUNT_ID in .env.local',
    );
  }
  const accountId = raw
    .replace(/^https?:\/\//, '')
    .replace(/\.r2\.cloudflarestorage\.com.*$/, '')
    .replace(/\/.*$/, '');
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

const client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

const bucket = process.env['CLOUDFLARE_R2_BUCKET'] ?? 'htmlradar-docs';

export function r2Key(userId: string, docId: string, version: number): string {
  return `docs/${userId}/${docId}/v${version}.html`;
}

export async function uploadHtml(key: string, body: Uint8Array): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'text/html; charset=utf-8',
    }),
  );
}

/**
 * Upload a binary attachment (PDF / Office doc / image / ZIP / etc.) to
 * R2 under the `attachments/...` namespace. ContentType comes from the
 * server-controlled `ALLOWED_EXTENSIONS` map (see lib/attachments.ts);
 * the user-provided MIME is never trusted.
 */
export async function uploadAttachment(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Delete an attachment from R2. Used when the sender removes an
 * attachment from a doc; we delete the DB row first, then the R2 object.
 * If the R2 delete fails the DB row is already gone — periodic
 * reconciliation (post-launch) can sweep orphaned R2 objects later. The
 * worse failure mode is an orphan file with no DB row, not a phantom
 * DB row pointing to nothing.
 */
export async function deleteR2Object(key: string): Promise<void> {
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}
