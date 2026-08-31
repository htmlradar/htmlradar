// Finding one of the caller's own shares from whatever they typed.
//
// An agent that was not the one to create the link knows it by what the
// dashboard and the link show, which is the slug, not the id. So every API
// route that names a single share accepts three things: the id, the slug, or
// the whole link. This file is the one place that resolution lives, so the
// activity route and the revoke route cannot come to disagree about what
// counts as the same share.

import type { SupabaseClient } from '@supabase/supabase-js';
import { SHARE_SLUG_PATTERN } from './share-slug';
import { SHARE_HOST } from './share-url';

const SITE_HOST = 'htmlradar.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The link as the app prints it, or the path part of it. Nothing looser: this
// is a lookup key, and "close enough" here is a way to hand someone the
// wrong share's activity.
//
// Two hosts are accepted. Recipient links live on the content domain now, and
// every link handed out before that move named the application domain — an
// agent reading a slug off an old email must still be understood. Any other
// host is rejected, so a link that merely looks like ours cannot be used to
// probe for shares.
//
// A third shape once handle links are switched on: a link on the owner's own
// subdomain, `{handle}.htmlradar.page/r/{slug}`. One label only, matching the
// format schema/043 enforces — an extra level is somebody else's host, not
// ours. The handle is not used to find the share: `host_handle` is stored on
// the row and the lookup below is scoped to the caller's own shares anyway,
// so accepting the label here only means an assistant can paste the link it
// was given.
const escapeHost = (host: string): string => host.replace(/\./g, '\\.');
const HANDLE_LABEL = '[a-z0-9][a-z0-9-]{1,22}[a-z0-9]';
const LINK_HOSTS = [`(?:${HANDLE_LABEL}\\.)?${escapeHost(SHARE_HOST)}`, escapeHost(SITE_HOST)].join(
  '|',
);
const LINK = new RegExp(`^(?:(?:https://)?(?:${LINK_HOSTS}))?/r/([^/]+)$`);

/**
 * The slug in what the caller passed, or null.
 *
 * The shape is checked against the same rule the database enforces on every
 * slug it stores, so a malformed value costs a regex and not a query.
 */
export function slugOf(raw: string): string | null {
  const candidate = LINK.exec(raw)?.[1] ?? raw;
  return SHARE_SLUG_PATTERN.test(candidate) ? candidate : null;
}

/**
 * The caller's share, by id, slug or link — or null.
 *
 * Null covers all three of "no such share", "malformed", and "somebody
 * else's": a key must not be usable to tell them apart. `owner_id` is always
 * selected and always checked here, whatever the caller asked for.
 */
export async function findOwnedShare<T extends { owner_id: string }>(
  supabase: SupabaseClient,
  userId: string,
  idOrSlug: string,
  columns: string,
): Promise<T | null> {
  let lookup = supabase.from('document_shares').select(`owner_id, ${columns}`);
  if (UUID.test(idOrSlug)) {
    lookup = lookup.eq('id', idOrSlug);
  } else {
    // A slug is only ever looked up within the caller's own shares, so a slug
    // that belongs to another account is not found rather than found and then
    // refused: the query cannot say whether it exists.
    const slug = slugOf(idOrSlug);
    if (!slug) return null;
    lookup = lookup.eq('owner_id', userId).eq('slug', slug);
  }

  const { data } = await lookup.maybeSingle();
  const share = data as T | null;
  return share && share.owner_id === userId ? share : null;
}
