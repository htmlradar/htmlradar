'use server';

// Server Action for creating a new document. Extracted into its own
// module so the form can be a Client Component with interactive toggle
// state, while keeping the action server-side.
//
// The write itself lives in lib/create-document.ts, shared with
// POST /api/v1/shares so the two paths cannot drift. What stays here is the
// form's own business: reading FormData, validating what the customer typed,
// and turning a failure into a message on /new.

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser, serverClient } from '@/lib/supabase-server';
import { captureServerEvent } from '@/lib/events';
import { isHtmlFile, validateSourceUrl } from '@/lib/html-source';
import { createDocumentForUser, MAX_UPLOAD_BYTES } from '@/lib/create-document';

export async function createDocument(formData: FormData) {
  const user = await requireUser();
  const supabase = serverClient();

  // Documents are no longer capped (pricing v4) — the free-tier lever is the
  // tracked-link cap, enforced at share creation (createShareAction +
  // enforce_share_cap, schema/027). Uploading a document is unrestricted.

  const sourceType = formData.get('source_type') as 'upload' | 'url';
  const title = String(formData.get('title') ?? '').trim() || 'Untitled document';

  // Failures are caught, captured as an event, and surfaced inline on /new —
  // previously any throw here fell through to the generic error boundary
  // with no analytics trail. Redirects stay at top level (redirect() throws
  // internally and must not be swallowed by this catch — house pattern from
  // docs/[id]/actions.ts).
  let docId: string | null = null;
  let errorMessage: string | null = null;
  try {
    if (sourceType === 'url') {
      const sourceUrl = String(formData.get('source_url') ?? '').trim();
      const urlError = validateSourceUrl(sourceUrl);
      if (urlError) throw new Error(urlError);
      docId = await createDocumentForUser(supabase, user.id, title, {
        type: 'url',
        url: sourceUrl,
      });
    } else {
      const file = formData.get('file') as File | null;
      if (!file || file.size === 0) throw new Error('No file uploaded');
      if (file.size > MAX_UPLOAD_BYTES) throw new Error('File exceeds 30 MB');
      if (!isHtmlFile(file.name, file.type)) {
        throw new Error('Only HTML files are supported. Rename your export to .html and retry.');
      }
      docId = await createDocumentForUser(supabase, user.id, title, {
        type: 'upload',
        bytes: new Uint8Array(await file.arrayBuffer()),
        filename: file.name || null,
      });
    }
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : 'Upload failed.';
  }

  if (errorMessage || !docId) {
    const reason = errorMessage ?? 'Upload failed.';
    await captureServerEvent({
      event: 'document.upload_failed',
      distinctId: user.id,
      userId: user.id,
      properties: { source_type: sourceType, reason },
    });
    redirect(`/new?upload_error=${encodeURIComponent(reason)}`);
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
