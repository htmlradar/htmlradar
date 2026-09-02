import { redirect } from 'next/navigation';
import {
  FULL_SCOPE,
  READ_SCOPE,
  createConsentNonce,
  validConnectRequest,
  type ConnectRequest,
} from '@/lib/connect';
import { safeNext } from '@/lib/safe-next';
import { serverClient } from '@/lib/supabase-server';

export const runtime = 'edge';

// A signed, single-use consent handoff, not a search result.
export const metadata = {
  title: 'Connect',
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

function requestFrom(values: SearchParams): ConnectRequest {
  return {
    tx: one(values.tx),
    clientId: one(values.client_id),
    clientHost: one(values.client_host),
    scope: one(values.scope),
    exp: one(values.exp),
    sig: one(values.sig),
  };
}

function connectPath(request: ConnectRequest): string {
  const query = new URLSearchParams({
    tx: request.tx,
    client_id: request.clientId,
    client_host: request.clientHost,
    scope: request.scope,
    exp: request.exp,
    sig: request.sig,
  });
  return safeNext(`/connect?${query}`);
}

function ErrorPage({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg">
        <a href="/" className="font-mono text-[13px] tracking-wide text-ink">
          HTML<span className="text-signal">Radar</span>
        </a>
        <h1 className="text-letterpress mt-10 font-serif text-[36px] leading-tight tracking-tightest text-ink">
          Connection unavailable.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">{message}</p>
      </div>
    </main>
  );
}

export default async function ConnectPage({ searchParams }: { searchParams?: SearchParams }) {
  const request = requestFrom(searchParams ?? {});
  const secret = process.env['CONNECT_SIGNING_SECRET'] ?? '';
  if (!(await validConnectRequest(request, secret))) {
    return (
      <ErrorPage message="This connection request is invalid or has expired. Start again from Claude." />
    );
  }

  const supabase = serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(connectPath(request))}`);

  if (one(searchParams?.problem) === 'key_limit') {
    return (
      <ErrorPage message="You already have 10 active keys. Revoke one in Settings, then try again." />
    );
  }

  if (one(searchParams?.problem) === 'create_failed') {
    return (
      <ErrorPage message="HTMLRadar could not create this connection. Try allowing it again." />
    );
  }

  const nonce = await createConsentNonce(request.tx, user.id, request.exp, secret);
  const canWrite = request.scope.split(' ').includes('shares:write');

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <a href="/" className="font-mono text-[13px] tracking-wide text-ink">
          HTML<span className="text-signal">Radar</span>
        </a>

        <h1 className="text-letterpress mt-10 text-balance font-serif text-[36px] font-normal leading-[1.08] tracking-tightest text-ink md:text-[44px]">
          Allow Claude to share HTML through your HTMLRadar account
        </h1>
        <p className="mt-4 break-words text-[15px] leading-relaxed text-ink-soft">
          <span className="font-medium text-ink">{request.clientHost}</span> is asking for access.
        </p>

        <form action="/connect/decision" method="post" className="mt-8">
          {Object.entries({
            tx: request.tx,
            client_id: request.clientId,
            client_host: request.clientHost,
            scope: request.scope,
            exp: request.exp,
            sig: request.sig,
            nonce,
          }).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}

          <fieldset>
            <legend className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
              Choose access
            </legend>
            <label className="mt-3 flex cursor-pointer gap-3 rounded-xl border border-line bg-paper p-4 has-[:checked]:border-signal/60 has-[:checked]:bg-signal/5">
              <input
                type="radio"
                name="granted_scope"
                value={READ_SCOPE}
                defaultChecked
                className="mt-1 accent-signal"
              />
              <span>
                <span className="block text-[14.5px] font-medium text-ink">Read-only</span>
                <span className="mt-1 block text-[13.5px] leading-relaxed text-ink-soft">
                  <span className="font-mono">shares:read</span> — see your links and who read them
                  (<span className="font-mono">list_shares</span>,{' '}
                  <span className="font-mono">get_share_activity</span>,{' '}
                  <span className="font-mono">whoami</span>).
                </span>
              </span>
            </label>

            {canWrite ? (
              <label className="mt-3 flex cursor-pointer gap-3 rounded-xl border border-line bg-paper p-4 has-[:checked]:border-signal/60 has-[:checked]:bg-signal/5">
                <input
                  type="radio"
                  name="granted_scope"
                  value={FULL_SCOPE}
                  className="mt-1 accent-signal"
                />
                <span>
                  <span className="block text-[14.5px] font-medium text-ink">Read and publish</span>
                  <span className="mt-1 block text-[13.5px] leading-relaxed text-ink-soft">
                    <span className="font-mono">shares:write</span> — publish, replace and switch
                    off links (adds <span className="font-mono">share_html</span>,{' '}
                    <span className="font-mono">create_share</span>,{' '}
                    <span className="font-mono">replace_document</span>,{' '}
                    <span className="font-mono">revoke_share</span>).
                  </span>
                </span>
              </label>
            ) : null}
          </fieldset>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="submit"
              name="decision"
              value="allow"
              className="rounded-md bg-signal px-5 py-2.5 text-[14px] font-medium text-paper transition hover:bg-signal-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
            >
              Allow
            </button>
            <button
              type="submit"
              name="decision"
              value="cancel"
              className="rounded-md border border-line bg-paper px-5 py-2.5 text-[14px] font-medium text-ink transition hover:border-alert hover:text-alert focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
