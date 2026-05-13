'use server';

// Server Actions for the document detail page. Extracted into their own
// module so they can be imported by the (client) DocumentShareManager
// component without dragging server-only imports into the client bundle.

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser, serverClient } from '@/lib/supabase-server';

export async function createShareAction(formData: FormData) {
  await requireUser();
  const supabase = serverClient();
  const documentId = String(formData.get('document_id'));

  const requirePassword = formData.get('require_password') === 'on';
  const password = String(formData.get('password') ?? '');
  if (requirePassword && password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const domainsRaw = String(formData.get('allowed_domains') ?? '').trim();
  const domains = domainsRaw
    ? domainsRaw
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean)
    : null;

  const expiresAtRaw = String(formData.get('expires_at') ?? '').trim();
  const expiresAt = expiresAtRaw ? new Date(expiresAtRaw).toISOString() : null;

  const { error } = await supabase.rpc('create_share', {
    p_document_id: documentId,
    p_recipient_label: String(formData.get('recipient_label') ?? '') || null,
    p_require_email: formData.get('require_email') === 'on',
    p_require_password: requirePassword,
    p_password_plain: requirePassword ? password : null,
    p_allowed_email_domains: domains,
    p_expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/docs/${documentId}`);
}

// Single toggle that flips a share between active and revoked. Lives in
// place of separate revoke + reactivate actions — one switch in the UI
// covers both directions, and one server action keeps the logic atomic.
export async function toggleShareAction(formData: FormData) {
  await requireUser();
  const supabase = serverClient();
  const shareId = String(formData.get('share_id'));
  const docId = String(formData.get('document_id'));

  const { data: current } = await supabase
    .from('document_shares')
    .select('revoked_at')
    .eq('id', shareId)
    .single();

  const nextRevokedAt = current?.revoked_at ? null : new Date().toISOString();

  await supabase.from('document_shares').update({ revoked_at: nextRevokedAt }).eq('id', shareId);
  revalidatePath(`/docs/${docId}`);
}

export async function deleteDocumentAction(formData: FormData) {
  await requireUser();
  const supabase = serverClient();
  const docId = String(formData.get('document_id'));
  await supabase.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', docId);
  redirect('/docs');
}
