'use server';

// Server Action for creating a new document. Extracted into its own
// module so the form can be a Client Component with interactive toggle
// state, while keeping the action server-side.
//
// The flow is intentionally INSERT-then-upload, not upload-then-INSERT:
// the doc-cap trigger (schema/003_triggers.sql) runs on INSERT and uses
// pg_advisory_xact_lock to serialize per-owner inserts. If the cap
// fires, we never touch R2. If the R2 upload fails afterwards, we
// DELETE the row so the user's cap counter doesn't move.

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser, serverClient } from '@/lib/supabase-server';
import { r2Key, uploadHtml } from '@/lib/r2';
import { captureServerEvent } from '@/lib/events';
import { isHtmlFile, validateSourceUrl } from '@/lib/html-source';

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

// Seed document_versions v1 for a freshly-created document. Retries once
// (failures here are almost always transient edge/network blips) and, if it
// still fails, captures an event so the gap is visible on /admin/events
// instead of silently leaving a document with no recorded v1.
async function seedFirstVersion(
  supabase: ReturnType<typeof serverClient>,
  userId: string,
  row: {
    document_id: string;
    filename: string | null;
    bytes: number | null;
    source_type: 'url' | 'upload';
    source_url: string | null;
    r2_key: string | null;
  },
) {
  const attempt = () =>
    supabase.from('document_versions').insert({ version: 1, replaced_by: userId, ...row });
  let { error } = await attempt();
  if (error) ({ error } = await attempt());
  if (error) {
    console.warn('[version-history] v1 insert failed:', error.message);
    await captureServerEvent({
      event: 'version.v1_seed_failed',
      distinctId: userId,
      userId,
      properties: { document_id: row.document_id, error: error.message },
    });
  }
}

export async function createDocument(formData: FormData) {
  const user = await requireUser();
  const supabase = serverClient();

  // Documents are no longer capped (pricing v4) — the free-tier lever is the
  // tracked-link cap, enforced at share creation (createShareAction +
  // enforce_share_cap, schema/027). Uploading a document is unrestricted.

  const sourceType = formData.get('source_type') as 'upload' | 'url';
  const title = String(formData.get('title') ?? '').trim() || 'Untitled document';
  const docId = crypto.randomUUID();

  if (sourceType === 'url') {
    const sourceUrl = String(formData.get('source_url') ?? '').trim();
    const urlError = validateSourceUrl(sourceUrl);
    if (urlError) throw new Error(urlError);
    const { error } = await supabase.from('documents').insert({
      id: docId,
      title,
      owner_id: user.id,
      source_type: 'url',
      source_url: sourceUrl,
    });
    if (error) throw new Error(error.message);

    // Seed version history (schema 018) with v1. Awaited because the Edge
    // runtime may terminate the worker after redirect; retried + logged on
    // failure rather than silently dropped (see seedFirstVersion).
    await seedFirstVersion(supabase, user.id, {
      document_id: docId,
      filename: null,
      bytes: null,
      source_type: 'url',
      source_url: sourceUrl,
      r2_key: null,
    });
  } else {
    const file = formData.get('file') as File | null;
    if (!file || file.size === 0) throw new Error('No file uploaded');
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('File exceeds 30 MB');
    if (!isHtmlFile(file.name, file.type)) {
      throw new Error('Only HTML files are supported. Rename your export to .html and retry.');
    }

    const key = r2Key(user.id, docId, 1);
    const { error: insertError } = await supabase.from('documents').insert({
      id: docId,
      title,
      owner_id: user.id,
      source_type: 'upload',
      r2_key: key,
    });
    if (insertError) throw new Error(insertError.message);

    try {
      await uploadHtml(key, new Uint8Array(await file.arrayBuffer()));
    } catch (err) {
      // Roll back the row so the user can retry without their cap moving.
      await supabase.from('documents').delete().eq('id', docId);
      throw err;
    }

    // Seed version history (schema 018) with v1, capturing the original
    // filename + size. Retried + logged on failure (see seedFirstVersion).
    await seedFirstVersion(supabase, user.id, {
      document_id: docId,
      filename: file.name || null,
      bytes: file.size,
      source_type: 'upload',
      source_url: null,
      r2_key: key,
    });
  }

  await captureServerEvent({
    event: 'document.created',
    distinctId: user.id,
    userId: user.id,
    properties: { source_type: sourceType, doc_id: docId },
  });

  revalidatePath('/docs');
  redirect(`/docs/${docId}`);
}
