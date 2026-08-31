// POST /api/v1/shares — turn an HTML file (or a URL, or a document that
// already exists) into a tracked link.
// GET  /api/v1/shares — the links this account has, newest first.
//
// The whole endpoint is the browser flow with the form removed: the document
// write is createDocumentForUser, shared verbatim with the /new server
// action, and the link write is create_share_as, which is create_share with
// the identity supplied explicitly (schema/034). Nothing about the free-tier
// cap, the chosen-address rules or the password minimum is re-implemented
// here — those are triggers on document_shares and they fire the same way for
// an API caller as for a signed-in one.
//
// `document_id` is the second link on a document that already exists, which
// is the ordinary case on the website — one document, one link per recipient,
// so the reading report separates them — and was unreachable from a machine
// until now. It creates no document, so it uploads nothing and screens
// nothing: the document it names went through the upload screen when it was
// created.

import type { NextRequest } from 'next/server';
import {
  authenticateApiKey,
  beforeFilter,
  CHEAP_MAX,
  creationMax,
  cursorOf,
  errorResponse,
  FREE_LIMIT_REACHED,
  INTERNAL,
  jsonResponse,
  mapCreateShareError,
  BODY_TIMED_OUT,
  NOT_FOUND,
  PAGE_SIZE,
  readBefore,
  readBodyCapped,
  REQUEST_TIMEOUT,
  serviceClient,
  STORAGE_FAILED,
  tooLarge,
  URL_MODE_DISABLED,
  validationError,
} from '@/lib/api-auth';
import { createDocumentForUser } from '@/lib/create-document';
import { validateSourceUrl } from '@/lib/html-source';
import { deleteR2Object, r2Key } from '@/lib/r2';
import { readQuota } from '@/lib/quota';
import { captureServerEvent } from '@/lib/events';
import { logServerError } from '@/lib/error-log';
import { shareUrl } from '@/lib/share-url';

export const runtime = 'edge';

const SITE_URL = 'https://htmlradar.com';
const ROUTE = '/api/v1/shares';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The largest document the API will store. Deliberately far below the 30 MB
// the browser upload accepts: a worker has 128 MB of memory and Cloudflare
// will hand it a body of up to 100 MB, so the API's ceiling is set by what an
// edge isolate can decode without trouble rather than by what R2 can hold.
// The web app's own limit is untouched.
const MAX_API_HTML_BYTES = 5 * 1024 * 1024;

// The largest request body we will read at all, as opposed to the largest
// document we will store (checked on the decoded bytes below). The gap is
// room for JSON string escaping — worst case a document of control characters
// grows six-fold, but a realistic HTML document grows by a fraction of a
// percent, so half a megabyte of slack is generous for anything that was
// going to be accepted anyway.
const MAX_REQUEST_BYTES = 5.5 * 1024 * 1024;

// URL mode is written, tested and switched off: the proxy that fetches the
// address does not yet reject every non-public network location (2026-08-30
// API/MCP audit, server-side request forgery). Flip to true only once it does.
const API_URL_MODE_ENABLED: boolean = false;

interface CreateShareBody {
  html?: unknown;
  url?: unknown;
  document_id?: unknown;
  title?: unknown;
  recipient_label?: unknown;
  require_email?: unknown;
  lock_deck?: unknown;
  password?: unknown;
  allowed_email_domains?: unknown;
  expires_in_hours?: unknown;
  slug?: unknown;
}

// The deck's own <title>, when the caller did not name it. Deliberately not a
// parser: one regex over the head of the document is enough for a default,
// and anything it misses falls through to "Untitled".
function titleFromHtml(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html.slice(0, 64_000));
  const title = match?.[1]?.replace(/\s+/g, ' ').trim();
  return title ? title.slice(0, 200) : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Undo the document when the link it was created for is refused.
 *
 * The browser creates a document and a link in two separate acts, so a
 * rejected link there leaves a document the customer meant to keep. One API
 * call is one act: a 402 or a 422 must not leave behind a document nobody
 * asked for and an R2 object nothing references. document_versions cascades
 * from documents (schema/018), so the row delete takes the version with it.
 *
 * Best effort — failing to tidy up must not turn a 422 into a 500.
 */
async function rollbackDocument(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  documentId: string,
  uploaded: boolean,
): Promise<void> {
  let failedStep: 'document_delete' | 'r2_delete' | 'both' | null = null;

  try {
    const { error } = await supabase.from('documents').delete().eq('id', documentId);
    if (error) failedStep = 'document_delete';
  } catch {
    failedStep = 'document_delete';
  }

  // Attempted even when the row survived. The two ways this can end badly are
  // an orphaned object holding customer content, and a document row pointing
  // at an object that is gone; the event below is what makes either one
  // findable afterwards, because neither is something the caller can fix.
  if (uploaded) {
    try {
      await deleteR2Object(r2Key(userId, documentId, 1));
    } catch {
      failedStep = failedStep ? 'both' : 'r2_delete';
    }
  }

  if (!failedStep) return;
  // Document id and which half failed. No title, no bytes, no object key.
  await captureServerEvent({
    event: 'api.rollback_failed',
    distinctId: userId,
    userId,
    properties: { document_id: documentId, step: failedStep },
  });
}

export async function POST(req: NextRequest) {
  // 75 creations an hour per account on Pro, 30 on free, and 120 an hour from
  // any one address. The account budget is counted on the account rather than
  // the key so a second key is not a second budget; the address budget is what
  // a script signing up for accounts in bulk runs into, which the account one
  // cannot see.
  const auth = await authenticateApiKey(req, {
    name: 'shares',
    per: 'account',
    max: creationMax,
    perIpMax: 120,
    write: true,
  });
  if ('error' in auth) return errorResponse(auth.error);
  const { caller } = auth;

  // Two checks, because the header alone is not one. An honest oversized
  // request says so in Content-Length and is refused here without a byte being
  // read; a chunked request carries no Content-Length at all, and a dishonest
  // one carries whatever the caller typed. So the header is the cheap refusal
  // and readBodyCapped below is the real one: it counts the bytes as they
  // arrive and abandons the read the moment they pass the cap. A worker has
  // 128 MB of memory and Cloudflare will hand it a body of up to 100 MB, so
  // measuring after buffering means any valid key can spend most of a worker
  // on a request that was always going to be a 413.
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return errorResponse(tooLarge(MAX_API_HTML_BYTES));
  }

  let body: CreateShareBody;
  try {
    const raw = await readBodyCapped(req, MAX_REQUEST_BYTES);
    if (raw === null) return errorResponse(tooLarge(MAX_API_HTML_BYTES));
    if (raw === BODY_TIMED_OUT) return errorResponse(REQUEST_TIMEOUT);
    body = JSON.parse(raw) as CreateShareBody;
  } catch {
    return errorResponse(validationError('Body must be JSON.'));
  }
  if (!body || typeof body !== 'object') {
    return errorResponse(validationError('Body must be a JSON object.'));
  }

  // --- what to track -------------------------------------------------
  const html = typeof body.html === 'string' ? body.html : null;
  const url = stringOrNull(body.url);
  const existingDocumentId = stringOrNull(body.document_id);
  const given = [html, url, existingDocumentId].filter((v) => v !== null).length;
  if (given === 0) {
    return errorResponse(validationError('Provide one of "html", "url" or "document_id".'));
  }
  if (given > 1) {
    return errorResponse(
      validationError('Provide only one of "html", "url" and "document_id" in a single call.'),
    );
  }

  let bytes: Uint8Array | null = null;
  if (existingDocumentId !== null) {
    if (!UUID.test(existingDocumentId)) return errorResponse(NOT_FOUND);
  } else if (html !== null) {
    bytes = new TextEncoder().encode(html);
    // Checked before anything is written or uploaded.
    if (bytes.byteLength > MAX_API_HTML_BYTES) return errorResponse(tooLarge(MAX_API_HTML_BYTES));
    if (!/<[a-z!/]/i.test(html)) {
      return errorResponse(validationError('"html" does not look like HTML.'));
    }
  } else {
    if (!API_URL_MODE_ENABLED) return errorResponse(URL_MODE_DISABLED);
    const urlProblem = validateSourceUrl(url!);
    if (urlProblem) return errorResponse(validationError(urlProblem));
    if (!/^https:\/\//i.test(url!)) {
      return errorResponse(validationError('"url" must be an https URL.'));
    }
  }

  // --- link settings -------------------------------------------------
  const title =
    stringOrNull(body.title)?.slice(0, 200) ?? (html ? titleFromHtml(html) : null) ?? 'Untitled';

  const requireEmail = body.require_email === undefined ? true : body.require_email === true;
  if (body.require_email !== undefined && typeof body.require_email !== 'boolean') {
    return errorResponse(validationError('"require_email" must be a boolean.'));
  }

  // "Lock the deck": blocks save and print and paints the tiled watermark.
  // True is both the column default (schema/015) and what the browser form
  // offers, so an absent field keeps the behaviour every existing caller has.
  if (body.lock_deck !== undefined && typeof body.lock_deck !== 'boolean') {
    return errorResponse(validationError('"lock_deck" must be a boolean.'));
  }
  const lockDeck = body.lock_deck === undefined ? true : body.lock_deck;

  const password = typeof body.password === 'string' && body.password ? body.password : null;

  let domains: string[] | null = null;
  if (body.allowed_email_domains !== undefined && body.allowed_email_domains !== null) {
    if (
      !Array.isArray(body.allowed_email_domains) ||
      body.allowed_email_domains.some((d) => typeof d !== 'string')
    ) {
      return errorResponse(validationError('"allowed_email_domains" must be an array of strings.'));
    }
    const list = (body.allowed_email_domains as string[])
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    domains = list.length > 0 ? list : null;
  }

  let expiresAt: string | null = null;
  if (body.expires_in_hours !== undefined && body.expires_in_hours !== null) {
    const hours = Number(body.expires_in_hours);
    if (!Number.isFinite(hours) || hours <= 0) {
      return errorResponse(validationError('"expires_in_hours" must be a positive number.'));
    }
    expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  }

  // Passed straight through: validate_share_slug (schema/033) owns the format,
  // the reserved list and the Pro entitlement, and it is the only one of those
  // three a caller cannot walk around.
  const slug = stringOrNull(body.slug)?.toLowerCase() ?? null;

  const supabase = serviceClient();

  // Free-tier cap, checked before the document is written. The trigger below
  // is the authoritative one; this pre-check exists so a capped caller does not
  // leave an uploaded orphan document behind on the way to its 402.
  const quota = await readQuota(supabase, caller.userId);
  if (quota.atCap) {
    await captureServerEvent({
      event: 'free_tier.share_cap_hit',
      distinctId: caller.userId,
      userId: caller.userId,
      properties: { via: 'api' },
    });
    return errorResponse(FREE_LIMIT_REACHED);
  }

  // --- write ---------------------------------------------------------
  let documentId: string;
  if (existingDocumentId !== null) {
    // Ownership is the whole of the check. A document belonging to somebody
    // else, or one the customer has deleted, is not found rather than refused:
    // a key must not be usable to discover that a document id exists.
    const { data: document } = await supabase
      .from('documents')
      .select('id')
      .eq('id', existingDocumentId)
      .eq('owner_id', caller.userId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!document) return errorResponse(NOT_FOUND);
    documentId = existingDocumentId;
  } else {
    try {
      documentId = await createDocumentForUser(
        supabase,
        caller.userId,
        title,
        bytes ? { type: 'upload', bytes, filename: null } : { type: 'url', url: url! },
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not store the document.';
      await logServerError({
        source: 'api.v1.shares',
        message,
        userId: caller.userId,
        route: ROUTE,
        context: { step: 'create_document', source_type: bytes ? 'upload' : 'url' },
      });
      await captureServerEvent({
        event: 'document.upload_failed',
        distinctId: caller.userId,
        userId: caller.userId,
        properties: { source_type: bytes ? 'upload' : 'url', reason: message, via: 'api' },
      });
      return errorResponse(STORAGE_FAILED);
    }
  }

  // Undoing the document is only ever right for a document this call created.
  // A refused link on somebody's existing deck must leave the deck, and every
  // link already pointing at it, exactly where they were.
  const undoDocument = () =>
    existingDocumentId !== null
      ? Promise.resolve()
      : rollbackDocument(supabase, caller.userId, documentId, bytes !== null);

  const { data: created, error } = await supabase.rpc('create_share_as', {
    p_user_id: caller.userId,
    p_document_id: documentId,
    p_recipient_label: stringOrNull(body.recipient_label),
    p_require_email: requireEmail,
    p_require_password: password !== null,
    p_password_plain: password,
    p_allowed_email_domains: domains,
    p_allowed_emails: null,
    p_expires_at: expiresAt,
    p_slug: slug,
  });
  if (error) {
    await undoDocument();
    const mapped = mapCreateShareError(error.message);
    // Anything mapCreateShareError did not recognise comes back as a bare
    // 500, so this is the only place the actual Postgres message survives.
    if (mapped.status >= 500) {
      await logServerError({
        source: 'api.v1.shares',
        message: error.message,
        userId: caller.userId,
        route: ROUTE,
        context: { step: 'create_share_as', document_id: documentId },
      });
    }
    return errorResponse(mapped);
  }

  const share = (Array.isArray(created) ? created[0] : created) as {
    id?: string;
    slug?: string;
  } | null;
  if (!share?.id || !share.slug) {
    await undoDocument();
    await logServerError({
      source: 'api.v1.shares',
      message: 'create_share_as returned no row',
      userId: caller.userId,
      route: ROUTE,
      context: { step: 'create_share_as', document_id: documentId },
    });
    return errorResponse(INTERNAL);
  }

  // Same shape as the browser flow: the link is created with the column
  // default and the toggle is a surgical follow-up, so create_share_as's
  // signature stays narrow. The dashboard's set_share_lock_deck RPC is not
  // available here — it is granted to `authenticated` and reads auth.uid() —
  // so the service client writes the column directly, scoped to the row this
  // call just created for this caller.
  if (!lockDeck) {
    const { error: lockError } = await supabase
      .from('document_shares')
      .update({ lock_deck: false })
      .eq('id', share.id)
      .eq('owner_id', caller.userId);
    if (lockError) {
      // One API call is one act. A link that quietly ignores a setting the
      // caller asked for is not the link they asked for, so it goes back with
      // its document (schema/001 cascades the share from the document).
      await undoDocument();
      await logServerError({
        source: 'api.v1.shares',
        message: lockError.message,
        userId: caller.userId,
        route: ROUTE,
        context: { step: 'set_lock_deck', document_id: documentId },
      });
      return errorResponse(INTERNAL);
    }
  }

  // Both events are emitted only once the whole call has succeeded — a
  // document that gets rolled back above never happened as far as analytics
  // is concerned. A second link on an existing document creates no document,
  // so it says nothing about one.
  if (existingDocumentId === null) {
    await captureServerEvent({
      event: 'document.created',
      distinctId: caller.userId,
      userId: caller.userId,
      properties: { source_type: bytes ? 'upload' : 'url', doc_id: documentId, via: 'api' },
    });
  }

  await captureServerEvent({
    event: 'share.created',
    distinctId: caller.userId,
    userId: caller.userId,
    properties: {
      document_id: documentId,
      slug: share.slug,
      require_email: requireEmail,
      require_password: password !== null,
      has_domain_allowlist: !!domains,
      has_email_allowlist: false,
      has_expiry: !!expiresAt,
      lock_deck: lockDeck,
      is_first_share: quota.used === 0,
      custom_slug: !!slug,
      existing_document: existingDocumentId !== null,
      via: 'api',
    },
  });

  return jsonResponse(201, {
    share_id: share.id,
    document_id: documentId,
    url: shareUrl(share.slug),
    dashboard_url: `${SITE_URL}/docs/${documentId}`,
  });
}

/**
 * GET /api/v1/shares — the account's links, newest first.
 *
 * The gap this closes: get_share_activity needs an identifier an assistant
 * can only have if it created the link in the same conversation. Everything
 * here is the caller's own by an explicit owner filter — there is no listing
 * RPC and no session to scope to, so the filter is the whole of the security
 * and it is written on every query below.
 *
 * "Opened" is the dashboard's own definition, not a row count: the owner's
 * internal test reads are out, and so are phantom sessions that bounced with
 * no active time and no scroll. A list that says opened where the activity
 * report says not opened would be worse than no list.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req, {
    name: 'shares-list',
    per: 'account',
    max: CHEAP_MAX,
  });
  if ('error' in auth) return errorResponse(auth.error);
  const { caller } = auth;

  const page = readBefore(req);
  if ('error' in page) return errorResponse(page.error);

  const supabase = serviceClient();
  let query = supabase
    .from('document_shares')
    .select('id, slug, document_id, recipient_label, created_at, revoked_at, expires_at')
    .eq('owner_id', caller.userId)
    // Both columns, in both places: the sort and the cursor have to agree, or
    // rows sharing a timestamp fall between two pages.
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);
  if (page.cursor) query = query.or(beforeFilter(page.cursor));

  const { data, error } = await query;
  if (error) {
    await logServerError({
      source: 'api.v1.shares',
      message: error.message,
      userId: caller.userId,
      route: ROUTE,
      context: { step: 'list_shares' },
    });
    return errorResponse(INTERNAL);
  }

  const rows = (data ?? []) as ShareListRow[];
  if (rows.length === 0) return jsonResponse(200, { shares: [], next_before: null });

  const shareIds = rows.map((row) => row.id);
  const documentIds = [...new Set(rows.map((row) => row.document_id))];

  // Titles and reads, in parallel. Both are bounded by the page above: at
  // most fifty shares and their documents, never the whole account.
  const [documents, sessions, internalViewers] = await Promise.all([
    supabase.from('documents').select('id, title').in('id', documentIds),
    supabase
      .from('sessions')
      .select('share_id, viewer_id, started_at, bounced, active_time_seconds, max_scroll_depth')
      .in('share_id', shareIds),
    supabase.from('viewers').select('id').in('share_id', shareIds).eq('is_internal', true),
  ]);

  const titleById = new Map(
    ((documents.data ?? []) as { id: string; title: string }[]).map((doc) => [doc.id, doc.title]),
  );
  const internal = new Set(((internalViewers.data ?? []) as { id: string }[]).map((v) => v.id));

  const lastOpen = new Map<string, string>();
  for (const session of (sessions.data ?? []) as SessionListRow[]) {
    if (internal.has(session.viewer_id)) continue;
    const phantom =
      session.bounced === true &&
      (session.active_time_seconds ?? 0) === 0 &&
      (session.max_scroll_depth ?? 0) === 0;
    if (phantom) continue;
    const previous = lastOpen.get(session.share_id);
    if (!previous || session.started_at > previous)
      lastOpen.set(session.share_id, session.started_at);
  }

  const now = Date.now();
  return jsonResponse(200, {
    shares: rows.map((row) => ({
      share_id: row.id,
      slug: row.slug,
      url: shareUrl(row.slug),
      recipient_label: row.recipient_label,
      document_id: row.document_id,
      document_title: titleById.get(row.document_id) ?? null,
      created_at: row.created_at,
      revoked: row.revoked_at !== null,
      revoked_at: row.revoked_at,
      expires_at: row.expires_at,
      expired: row.expires_at !== null && new Date(row.expires_at).getTime() <= now,
      opened: lastOpen.has(row.id),
      last_open: lastOpen.get(row.id) ?? null,
    })),
    // Only when the page was full. A short page is the end of the list, and
    // a cursor there would send the caller round one more empty request.
    next_before: rows.length === PAGE_SIZE ? cursorOf(rows[rows.length - 1]!) : null,
  });
}

interface ShareListRow {
  id: string;
  slug: string;
  document_id: string;
  recipient_label: string | null;
  created_at: string;
  revoked_at: string | null;
  expires_at: string | null;
}

interface SessionListRow {
  share_id: string;
  viewer_id: string;
  started_at: string;
  bounced: boolean | null;
  active_time_seconds: number | null;
  max_scroll_depth: number | null;
}
