// GET /api/v1/documents — the account's documents, newest first.
//
// The other half of the listing gap. An assistant that wants a second link
// for last week's deck needs the deck's identifier, and until now the only
// way to get one was for the person to open the dashboard and copy it.
//
// There is no listing function in the database to call: the dashboard's own
// queries run through a cookie-scoped client and lean on row-level security
// to see only the signed-in customer's rows. An API request has no session,
// so the owner filter here is written out on every query and is the whole of
// the security. Soft-deleted documents are excluded, as they are on /docs.
//
// What is deliberately not returned: the phishing screen's score and signals
// (schema/039). They are an operator's evidence, they are advisory, and a
// customer reading their own score back is a customer being told what the
// screen looks for.

import type { NextRequest } from 'next/server';
import {
  authenticateApiKey,
  beforeFilter,
  CHEAP_MAX,
  errorResponse,
  INTERNAL,
  cursorOf,
  jsonResponse,
  PAGE_SIZE,
  readBefore,
  serviceClient,
} from '@/lib/api-auth';
import { logServerError } from '@/lib/error-log';

export const runtime = 'edge';

const ROUTE = '/api/v1/documents';

interface DocumentRow {
  id: string;
  title: string;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req, {
    name: 'documents-list',
    per: 'account',
    max: CHEAP_MAX,
  });
  if ('error' in auth) return errorResponse(auth.error);
  const { caller } = auth;

  const page = readBefore(req);
  if ('error' in page) return errorResponse(page.error);

  const supabase = serviceClient();
  let query = supabase
    .from('documents')
    .select('id, title, created_at')
    .eq('owner_id', caller.userId)
    .is('deleted_at', null)
    // Both columns, in both places: the sort and the cursor have to agree, or
    // rows sharing a timestamp fall between two pages.
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);
  if (page.cursor) query = query.or(beforeFilter(page.cursor));

  const { data, error } = await query;
  if (error) {
    await logServerError({
      source: 'api.v1.documents',
      message: error.message,
      userId: caller.userId,
      route: ROUTE,
      context: { step: 'list_documents' },
    });
    return errorResponse(INTERNAL);
  }

  const rows = (data ?? []) as DocumentRow[];
  if (rows.length === 0) return jsonResponse(200, { documents: [], next_before: null });

  // How many links point at each document, so an assistant can tell a deck
  // that has been sent to twenty people from one that has never been sent.
  // ponytail: the ids are counted in memory over one query bounded by the
  // page above. A grouped count in Postgres needs a view or an RPC, which is
  // a migration for a number this cheap to add up.
  const { data: shareRows } = await supabase
    .from('document_shares')
    .select('document_id')
    .eq('owner_id', caller.userId)
    .in(
      'document_id',
      rows.map((row) => row.id),
    );

  const shareCount = new Map<string, number>();
  for (const share of (shareRows ?? []) as { document_id: string }[]) {
    shareCount.set(share.document_id, (shareCount.get(share.document_id) ?? 0) + 1);
  }

  return jsonResponse(200, {
    documents: rows.map((row) => ({
      document_id: row.id,
      title: row.title,
      created_at: row.created_at,
      share_count: shareCount.get(row.id) ?? 0,
    })),
    next_before: rows.length === PAGE_SIZE ? cursorOf(rows[rows.length - 1]!) : null,
  });
}
