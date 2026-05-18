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

const FREE_TIER_CAP = 10;
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

export async function createDocument(formData: FormData) {
  const user = await requireUser();
  const supabase = serverClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier')
    .eq('id', user.id)
    .single();
  if (profile?.tier !== 'pro') {
    // Lifetime cap — count deleted rows too. Must match the trigger in
    // schema/003_triggers.sql (which counts ALL documents, including
    // soft-deleted). Earlier the UI filtered by deleted_at IS NULL,
    // which let the action pass the check then the trigger reject the
    // INSERT — a confusing 500 instead of a clean /upgrade redirect.
    const { count } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id);
    if ((count ?? 0) >= FREE_TIER_CAP) {
      await captureServerEvent({
        event: 'free_tier.cap_hit',
        distinctId: user.id,
        userId: user.id,
      });
      redirect('/upgrade?reason=quota');
    }
  }

  const sourceType = formData.get('source_type') as 'upload' | 'url';
  const title = String(formData.get('title') ?? '').trim() || 'Untitled document';
  const docId = crypto.randomUUID();

  if (sourceType === 'url') {
    const sourceUrl = String(formData.get('source_url') ?? '').trim();
    if (!/^https?:\/\//i.test(sourceUrl)) throw new Error('Invalid URL');
    const { error } = await supabase.from('documents').insert({
      id: docId,
      title,
      owner_id: user.id,
      source_type: 'url',
      source_url: sourceUrl,
    });
    if (error) throw new Error(error.message);

    // Seed version history (schema 018) with v1 for URL-source docs.
    // Awaited because the Edge runtime is free to terminate the worker
    // after redirect; fire-and-forget would drop the write. Swallow any
    // error — history-write failure should not surface as an upload
    // failure to the user, but logging it would help debug RLS issues.
    const { error: versionErr } = await supabase.from('document_versions').insert({
      document_id: docId,
      version: 1,
      filename: null,
      bytes: null,
      source_type: 'url',
      source_url: sourceUrl,
      r2_key: null,
      replaced_by: user.id,
    });
    if (versionErr) console.warn('[version-history] v1 insert failed:', versionErr.message);
  } else {
    const file = formData.get('file') as File | null;
    if (!file || file.size === 0) throw new Error('No file uploaded');
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('File exceeds 30 MB');

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

    // Seed version history (schema 018) with v1 for upload docs. Captures
    // the original local filename + size for the version-history popover.
    // Awaited for the same Edge-runtime reason as the URL branch above.
    const { error: versionErr } = await supabase.from('document_versions').insert({
      document_id: docId,
      version: 1,
      filename: file.name || null,
      bytes: file.size,
      source_type: 'upload',
      source_url: null,
      r2_key: key,
      replaced_by: user.id,
    });
    if (versionErr) console.warn('[version-history] v1 insert failed:', versionErr.message);
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
