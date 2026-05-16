'use server';

// Server Actions for the document detail page. Extracted into their own
// module so they can be imported by the (client) DocumentShareManager
// component without dragging server-only imports into the client bundle.

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser, serverClient } from '@/lib/supabase-server';
import { captureServerEvent } from '@/lib/events';
import { issueOwnerDocPreviewToken, issueOwnerPreviewToken } from '@/lib/preview-token';
import { deleteR2Object, r2Key, uploadAttachment, uploadHtml } from '@/lib/r2';
import {
  MAX_ATTACHMENTS_PER_DOC,
  MAX_TOTAL_BYTES_PER_DOC,
  isValidationError,
  r2KeyForAttachment,
  validateFile,
} from '@/lib/attachments';

// Shared parse for the two allowlist textareas. Domains in one field,
// specific emails in another. Both accept comma- and newline-separated
// input (people paste lists from spreadsheets); blank fields → null so
// the RPC writes NULL into the column instead of an empty array (which
// would still satisfy `length > 0 = false`, but explicit NULL is clearer
// in DB inspection).
function parseAllowlists(formData: FormData): {
  domains: string[] | null;
  emails: string[] | null;
} {
  const split = (raw: string): string[] =>
    raw
      .split(/[,\n]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

  const domainsRaw = String(formData.get('allowed_domains') ?? '').trim();
  const emailsRaw = String(formData.get('allowed_emails') ?? '').trim();
  const domainList = domainsRaw ? split(domainsRaw) : [];
  const emailList = emailsRaw ? split(emailsRaw) : [];
  return {
    domains: domainList.length > 0 ? domainList : null,
    emails: emailList.length > 0 ? emailList : null,
  };
}

export async function createShareAction(formData: FormData) {
  const user = await requireUser();
  const supabase = serverClient();
  const documentId = String(formData.get('document_id'));

  // Server Actions can throw, but a thrown error inside an `action={...}`
  // form submission reaches the user as a generic Next.js error boundary
  // (5xx page) — they have no clue what went wrong. We catch everything
  // here and redirect to the doc page with a readable `share_error` query
  // param. DocumentShareManager reads the param and displays it inline.
  let slug: string | null = null;
  let errorMessage: string | null = null;
  try {
    const requirePassword = formData.get('require_password') === 'on';
    const password = String(formData.get('password') ?? '');
    if (requirePassword && password.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }

    const { domains, emails } = parseAllowlists(formData);

    const expiresAtRaw = String(formData.get('expires_at') ?? '').trim();
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw).toISOString() : null;

    const { data: created, error } = await supabase.rpc('create_share', {
      p_document_id: documentId,
      p_recipient_label: String(formData.get('recipient_label') ?? '') || null,
      p_require_email: formData.get('require_email') === 'on',
      p_require_password: requirePassword,
      p_password_plain: requirePassword ? password : null,
      p_allowed_email_domains: domains,
      p_allowed_emails: emails,
      p_expires_at: expiresAt,
    });
    if (error) throw new Error(error.message);

    slug =
      (Array.isArray(created) ? created[0]?.slug : (created as { slug?: string } | null)?.slug) ??
      null;
    const createdId =
      (Array.isArray(created) ? created[0]?.id : (created as { id?: string } | null)?.id) ?? null;

    // Surgical follow-up: set allow_download via the dedicated RPC so the
    // create_share signature stays narrow (otherwise adding/removing
    // per-share toggles forces another DROP+CREATE on the big RPC every
    // time). Skipped if the toggle wasn't on (DB default is false).
    const allowDownload = formData.get('allow_download') === 'on';
    if (createdId && allowDownload) {
      const { error: toggleErr } = await supabase.rpc('set_share_allow_download', {
        p_share_id: createdId,
        p_allow_download: true,
      });
      if (toggleErr) throw new Error(toggleErr.message);
    }

    await captureServerEvent({
      event: 'share.created',
      distinctId: user.id,
      userId: user.id,
      properties: {
        document_id: documentId,
        slug,
        require_email: formData.get('require_email') === 'on',
        require_password: requirePassword,
        has_domain_allowlist: !!domains,
        has_email_allowlist: !!emails,
        has_expiry: !!expiresAt,
      },
    });

    revalidatePath(`/docs/${documentId}`);
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : 'Failed to create the share.';
  }

  // All redirects sit at the top level — Next.js implements redirect() by
  // throwing a special error internally, so they must NOT be inside the
  // try block above.
  if (errorMessage) {
    redirect(`/docs/${documentId}?share_error=${encodeURIComponent(errorMessage)}`);
  }
  if (slug) {
    redirect(`/dashboard/${slug}?just_created=1`);
  }
  redirect(`/docs/${documentId}`);
}

// Single toggle that flips a share between active and revoked. Lives in
// place of separate revoke + reactivate actions — one switch in the UI
// covers both directions, and one server action keeps the logic atomic.
export async function toggleShareAction(formData: FormData) {
  const user = await requireUser();
  const supabase = serverClient();
  const shareId = String(formData.get('share_id'));
  const docId = String(formData.get('document_id'));

  let errorMessage: string | null = null;
  try {
    const { data: current, error: readErr } = await supabase
      .from('document_shares')
      .select('revoked_at')
      .eq('id', shareId)
      .single();
    if (readErr) throw new Error(readErr.message);

    const nextRevokedAt = current?.revoked_at ? null : new Date().toISOString();

    const { error: writeErr } = await supabase
      .from('document_shares')
      .update({ revoked_at: nextRevokedAt })
      .eq('id', shareId);
    if (writeErr) throw new Error(writeErr.message);

    await captureServerEvent({
      event: nextRevokedAt ? 'share.revoked' : 'share.reactivated',
      distinctId: user.id,
      userId: user.id,
      properties: { share_id: shareId, document_id: docId },
    });

    revalidatePath(`/docs/${docId}`);
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : 'Failed to update the share.';
  }

  if (errorMessage) {
    redirect(`/docs/${docId}?share_error=${encodeURIComponent(errorMessage)}`);
  }
}

// Edit an existing share's settings without revoke + recreate. Mirrors
// createShareAction's input shape; goes through the update_share RPC
// (migration 007) which enforces ownership + password hashing + length
// rules server-side.
export async function editShareAction(formData: FormData) {
  const user = await requireUser();
  const supabase = serverClient();
  const shareId = String(formData.get('share_id'));
  const documentId = String(formData.get('document_id'));

  let errorMessage: string | null = null;
  try {
    const requirePassword = formData.get('require_password') === 'on';
    const password = String(formData.get('password') ?? '');
    if (requirePassword && password.length > 0 && password.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }

    const { domains, emails } = parseAllowlists(formData);

    const expiresAtRaw = String(formData.get('expires_at') ?? '').trim();
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw).toISOString() : null;

    // Empty password input means "keep existing hash" — the RPC handles
    // that branch. Only pass a string when the user is actually setting
    // a new password.
    const passwordPlain = requirePassword && password.length > 0 ? password : null;

    const { error } = await supabase.rpc('update_share', {
      p_share_id: shareId,
      p_recipient_label: String(formData.get('recipient_label') ?? '') || null,
      p_require_email: formData.get('require_email') === 'on',
      p_require_password: requirePassword,
      p_password_plain: passwordPlain,
      p_allowed_email_domains: domains,
      p_allowed_emails: emails,
      p_expires_at: expiresAt,
    });
    if (error) throw new Error(error.message);

    // Apply the allow_download toggle separately (see createShareAction
    // for rationale). Always called on edit — including for the OFF
    // case — so unchecking the box flips the column to false.
    const allowDownload = formData.get('allow_download') === 'on';
    const { error: toggleErr } = await supabase.rpc('set_share_allow_download', {
      p_share_id: shareId,
      p_allow_download: allowDownload,
    });
    if (toggleErr) throw new Error(toggleErr.message);

    await captureServerEvent({
      event: 'share.edited',
      distinctId: user.id,
      userId: user.id,
      properties: {
        share_id: shareId,
        document_id: documentId,
        require_email: formData.get('require_email') === 'on',
        require_password: requirePassword,
        has_domain_allowlist: !!domains,
        has_email_allowlist: !!emails,
        has_expiry: !!expiresAt,
      },
    });

    revalidatePath(`/docs/${documentId}`);
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : 'Failed to update the share.';
  }

  if (errorMessage) {
    redirect(
      `/docs/${documentId}?share_error=${encodeURIComponent(errorMessage)}&edited=${shareId}`,
    );
  }
  redirect(`/docs/${documentId}?edited=${shareId}`);
}

// "Preview as you" — mint a short-lived owner-preview token bound to the
// share slug and redirect to the proxy with ?owner_preview=<token>. The
// proxy verifies the HMAC and bypasses revoked/expired/password/email,
// so the doc owner can see the actual document without satisfying the
// recipient gate.
//
// Ownership is enforced here (the action requires Supabase auth and
// confirms the share belongs to the user) so the proxy doesn't need
// to re-check — the HMAC's possession is the proof.
//
// Requires SESSION_SECRET env var to be set in the app deploy, matching
// the proxy's wrangler.toml SESSION_SECRET. If they diverge the proxy's
// verify call will reject the token.
// Same shape as previewDocumentAction: returns the URL for the client
// to hard-navigate to. See that action's comment for why we don't
// redirect() server-side.
export async function previewShareAction(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const supabase = serverClient();
  const shareId = String(formData.get('share_id'));

  try {
    const { data: share, error } = await supabase
      .from('document_shares')
      .select('slug, owner_id, document_id')
      .eq('id', shareId)
      .single();
    if (error) throw new Error(error.message);
    if (!share) throw new Error('Share not found.');
    if (share.owner_id !== user.id) throw new Error('Not your share.');

    const secret = process.env['SESSION_SECRET'];
    if (!secret) {
      throw new Error(
        'SESSION_SECRET is not set on the app — preview requires the same secret the proxy uses.',
      );
    }

    const token = await issueOwnerPreviewToken(share.slug, secret);
    const url = `https://htmlradar.com/r/${share.slug}?owner_preview=${encodeURIComponent(token)}`;

    await captureServerEvent({
      event: 'share.preview_opened',
      distinctId: user.id,
      userId: user.id,
      properties: { share_id: shareId, document_id: share.document_id },
    });

    return { ok: true, url };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Failed to start preview.';
    return { ok: false, error };
  }
}

// ============================================================
// Supporting materials (attachments) — Sprint B
// ============================================================

// Upload one or more files as supporting materials on a document. Caps
// enforced server-side:
//   - per-file: 25 MB (also enforced by the document_attachments CHECK
//     constraint so a stray client edit can't get past)
//   - per-doc: 20 files, 100 MB total
// Extension allowlist applied (ALLOWED_EXTENSIONS). Sanitised filename
// goes into both the DB row and the R2 key. Owner verified.
//
// Insert-then-upload pattern (mirrors createDocument): we INSERT the
// row first so a concurrent UPLOAD can't bypass the per-doc count cap;
// if R2 fails afterwards we DELETE the row. Worst case is a brief
// window where the row exists with no file — the proxy's R2 .get()
// returns null and the recipient gets a clean 404 instead of a crash.
export async function uploadAttachmentsAction(formData: FormData) {
  const user = await requireUser();
  const supabase = serverClient();
  const documentId = String(formData.get('document_id'));

  let errorMessage: string | null = null;

  try {
    // Confirm ownership BEFORE accepting any payload.
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, owner_id, deleted_at')
      .eq('id', documentId)
      .single();
    if (docErr) throw new Error(docErr.message);
    if (!doc || doc.deleted_at) throw new Error('Document not found.');
    if (doc.owner_id !== user.id) throw new Error('Not your document.');

    // Count + sum the existing attachments for cap enforcement. RLS
    // already restricts this to the owner; the explicit owner_id filter
    // is belt-and-suspenders.
    const { data: existing, error: countErr } = await supabase
      .from('document_attachments')
      .select('size_bytes')
      .eq('document_id', documentId)
      .eq('owner_id', user.id);
    if (countErr) throw new Error(countErr.message);
    const existingCount = existing?.length ?? 0;
    const existingBytes = (existing ?? []).reduce(
      (acc, row) => acc + Number(row.size_bytes ?? 0),
      0,
    );

    // Pull every <input type="file" name="files"> entry. The browser
    // submits as `files: File, files: File, ...`. We support 1..N.
    const files = formData.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new Error('No files selected.');

    // Per-doc count cap.
    if (existingCount + files.length > MAX_ATTACHMENTS_PER_DOC) {
      throw new Error(
        `Limit ${MAX_ATTACHMENTS_PER_DOC} files per document — you have ${existingCount}, attempted ${files.length}.`,
      );
    }

    // Validate every file before we do ANY I/O. If even one is bad we
    // reject the whole batch so the user doesn't end up with a partial
    // upload to chase down.
    const validated: { file: File; filename: string; mimeType: string; size: number }[] = [];
    let addedBytes = 0;
    for (const f of files) {
      const v = validateFile(f);
      if (isValidationError(v)) {
        throw new Error(`${v.filename}: ${v.reason}`);
      }
      addedBytes += v.size;
      validated.push({ file: f, filename: v.filename, mimeType: v.mimeType, size: v.size });
    }
    if (existingBytes + addedBytes > MAX_TOTAL_BYTES_PER_DOC) {
      throw new Error(
        `Total size would exceed ${Math.round(MAX_TOTAL_BYTES_PER_DOC / 1024 / 1024)} MB.`,
      );
    }

    // Process sequentially. Server Actions on Edge run with a wall-clock
    // limit; parallelising would help, but sequential lets us roll back
    // ONLY the failed row + objects without a partial-success knot.
    for (const v of validated) {
      const attachmentId = crypto.randomUUID();
      const r2Key = r2KeyForAttachment(user.id, documentId, attachmentId, v.filename);

      const { error: insertErr } = await supabase.from('document_attachments').insert({
        id: attachmentId,
        document_id: documentId,
        owner_id: user.id,
        filename: v.filename,
        mime_type: v.mimeType,
        size_bytes: v.size,
        r2_key: r2Key,
      });
      if (insertErr) throw new Error(insertErr.message);

      try {
        await uploadAttachment(r2Key, new Uint8Array(await v.file.arrayBuffer()), v.mimeType);
      } catch (uploadErr) {
        // Roll back this row so the cap counter stays honest. Other
        // already-uploaded rows in this batch stay (they're real).
        await supabase.from('document_attachments').delete().eq('id', attachmentId);
        throw uploadErr;
      }

      await captureServerEvent({
        event: 'attachment.uploaded',
        distinctId: user.id,
        userId: user.id,
        properties: {
          document_id: documentId,
          attachment_id: attachmentId,
          mime_type: v.mimeType,
          size_bytes: v.size,
        },
      });
    }

    revalidatePath(`/docs/${documentId}`);
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : 'Failed to upload attachments.';
  }

  if (errorMessage) {
    redirect(`/docs/${documentId}?attachment_error=${encodeURIComponent(errorMessage)}`);
  }
  redirect(`/docs/${documentId}`);
}

// Delete a single attachment. DB row goes first; if the R2 delete fails
// we end up with a harmless orphan object (counts toward storage but
// can't be downloaded — the proxy looks up by DB row first). Better
// than leaving a phantom DB row pointing at a missing file, which would
// confuse the recipient with a broken download link.
export async function deleteAttachmentAction(formData: FormData) {
  const user = await requireUser();
  const supabase = serverClient();
  const attachmentId = String(formData.get('attachment_id'));
  const documentId = String(formData.get('document_id'));

  let errorMessage: string | null = null;

  try {
    const { data: attachment, error: lookupErr } = await supabase
      .from('document_attachments')
      .select('id, owner_id, r2_key, document_id, filename')
      .eq('id', attachmentId)
      .single();
    if (lookupErr) throw new Error(lookupErr.message);
    if (!attachment) throw new Error('Attachment not found.');
    if (attachment.owner_id !== user.id) throw new Error('Not your attachment.');

    const { error: deleteErr } = await supabase
      .from('document_attachments')
      .delete()
      .eq('id', attachmentId);
    if (deleteErr) throw new Error(deleteErr.message);

    // Best-effort R2 cleanup. Swallow errors — the orphan path is
    // documented above and reconciliation is a post-launch concern.
    try {
      await deleteR2Object(attachment.r2_key);
    } catch (e) {
      // Log via the event capture so we can spot patterns; don't fail
      // the user-visible action.
      await captureServerEvent({
        event: 'attachment.r2_orphan',
        distinctId: user.id,
        userId: user.id,
        properties: {
          document_id: documentId,
          attachment_id: attachmentId,
          r2_key: attachment.r2_key,
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }

    await captureServerEvent({
      event: 'attachment.deleted',
      distinctId: user.id,
      userId: user.id,
      properties: { document_id: documentId, attachment_id: attachmentId },
    });

    revalidatePath(`/docs/${documentId}`);
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : 'Failed to delete attachment.';
  }

  if (errorMessage) {
    redirect(`/docs/${documentId}?attachment_error=${encodeURIComponent(errorMessage)}`);
  }
  redirect(`/docs/${documentId}`);
}

// "Preview document" — the sender's pre-share preview. Mints a token
// bound to the doc_id (not a share slug) and returns the proxy URL the
// CLIENT must navigate to. We deliberately do NOT call redirect() here:
// Next.js Server Actions intercept same-hostname redirects via the
// client-side router, which would try to resolve /r/_doc/... inside
// the Next.js route tree and 404 (because /r/* is a Worker route, not
// a Next.js route). Returning the URL forces the caller to do a hard
// window.location navigation, which is what we want — the browser
// GETs the proxy directly.
//
// Distinct from previewShareAction (which is bound to a SHARE slug and
// shows the recipient-style view with the tracker injected). This one
// is for "is my uploaded file even correct?" not "how would a recipient
// see this share?"
//
// Requires SESSION_SECRET to match the proxy's wrangler.toml value.
export async function previewDocumentAction(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const supabase = serverClient();
  const documentId = String(formData.get('document_id'));

  try {
    // r2_key + source_type are pulled so we can fail-fast with a clear
    // message if the doc has no blob to preview (URL-source or a botched
    // upload that left the row without a key).
    const { data: doc, error } = await supabase
      .from('documents')
      .select('id, owner_id, deleted_at, source_type, r2_key')
      .eq('id', documentId)
      .single();
    if (error) throw new Error(error.message);
    if (!doc) throw new Error('Document not found.');
    if (doc.owner_id !== user.id) throw new Error('Not your document.');
    if (doc.deleted_at) throw new Error('This document has been deleted.');
    if (doc.source_type !== 'upload') {
      throw new Error(
        'Preview is only available for uploaded HTML — URL-source docs open their source directly.',
      );
    }
    if (!doc.r2_key) {
      throw new Error('This document is missing its uploaded blob. Re-upload the HTML to fix.');
    }

    const secret = process.env['SESSION_SECRET'];
    if (!secret) {
      throw new Error(
        'Preview is unavailable — the deploy is missing its SESSION_SECRET env var. Set it on Cloudflare Pages (must match the Worker secret) and retry.',
      );
    }

    const token = await issueOwnerDocPreviewToken(doc.id, secret);
    const url = `https://htmlradar.com/r/_doc/${doc.id}?owner_doc_preview=${encodeURIComponent(token)}`;

    await captureServerEvent({
      event: 'document.preview_opened',
      distinctId: user.id,
      userId: user.id,
      properties: { document_id: doc.id },
    });

    return { ok: true, url };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Failed to start document preview.';
    return { ok: false, error };
  }
}

export async function deleteDocumentAction(formData: FormData) {
  const user = await requireUser();
  const supabase = serverClient();
  const docId = String(formData.get('document_id'));

  let errorMessage: string | null = null;
  try {
    const { error } = await supabase
      .from('documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', docId);
    if (error) throw new Error(error.message);

    await captureServerEvent({
      event: 'document.deleted',
      distinctId: user.id,
      userId: user.id,
      properties: { document_id: docId },
    });
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : 'Failed to delete the document.';
  }

  if (errorMessage) {
    redirect(`/docs/${docId}?delete_error=${encodeURIComponent(errorMessage)}`);
  }
  redirect('/docs');
}

// Replace the HTML body of an existing upload-type document with a new
// version. Same R2 key namespace (`docs/{owner}/{doc}/v{n}.html`), bumped
// version number. Existing share slugs keep working — they fetch the
// current_version row from the document, so recipients automatically see
// the new HTML on their next open.
//
// Old R2 objects are left in place (cheap; preserves a recovery path).
// We don't delete them yet because R2 list/cleanup is a separate sweep
// (post-launch) and the cost is negligible at our scale.
//
// Constraints:
//   - upload-type docs only (URL-source docs update their content at the
//     source; replacing here would be meaningless)
//   - same 30 MB ceiling as createDocument
//   - sender must own the doc (RLS would block anyway, but we check
//     explicitly so the error is clear)
const MAX_REPLACE_BYTES = 30 * 1024 * 1024;

export async function replaceDocumentAction(formData: FormData) {
  const user = await requireUser();
  const supabase = serverClient();
  const documentId = String(formData.get('document_id'));

  let errorMessage: string | null = null;

  try {
    const { data: doc, error: fetchErr } = await supabase
      .from('documents')
      .select('id, owner_id, source_type, current_version, deleted_at')
      .eq('id', documentId)
      .single();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!doc) throw new Error('Document not found.');
    if (doc.owner_id !== user.id) throw new Error('Not your document.');
    if (doc.deleted_at) throw new Error('This document has been deleted.');
    if (doc.source_type !== 'upload') {
      throw new Error('URL-source documents update at their source; nothing to replace here.');
    }

    const file = formData.get('file') as File | null;
    if (!file || file.size === 0) throw new Error('No file uploaded.');
    if (file.size > MAX_REPLACE_BYTES) {
      throw new Error('File exceeds the 30 MB limit.');
    }
    // Same content-type guard as the create flow. We deliberately accept
    // a broad set (browsers report inconsistently), but reject obvious
    // non-HTML so the recipient view never tries to render binary garbage.
    if (file.type && !file.type.includes('html') && file.type !== '') {
      throw new Error('Only HTML files can replace a document.');
    }

    const nextVersion = (doc.current_version ?? 0) + 1;
    const newKey = r2Key(user.id, doc.id, nextVersion);

    // Upload first. If this fails, the DB row still points at the prior
    // version's blob — recipients are unaffected. If the DB update fails
    // after a successful upload, we have an orphan R2 object (acceptable;
    // periodic sweep cleans these up).
    await uploadHtml(newKey, new Uint8Array(await file.arrayBuffer()));

    const { error: updateErr } = await supabase
      .from('documents')
      .update({
        current_version: nextVersion,
        r2_key: newKey,
        updated_at: new Date().toISOString(),
      })
      .eq('id', doc.id)
      .eq('owner_id', user.id);
    if (updateErr) throw new Error(updateErr.message);

    await captureServerEvent({
      event: 'document.replaced',
      distinctId: user.id,
      userId: user.id,
      properties: { document_id: doc.id, version: nextVersion },
    });

    revalidatePath(`/docs/${doc.id}`);
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : 'Failed to replace the document.';
  }

  if (errorMessage) {
    redirect(`/docs/${documentId}?replace_error=${encodeURIComponent(errorMessage)}`);
  }
  redirect(`/docs/${documentId}?replaced=1`);
}
