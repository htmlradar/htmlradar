// AgentExchange — what an HTMLRadar exchange with an agent actually looks
// like: you say it in words, the agent calls one tool, and a tracked link or
// a reading report comes back. One component so the homepage's "Share
// straight from Claude" section and the three use-case cards on /mcp speak
// the same visual language instead of each inventing one.
//
// Everything shown is the real wording the server prints (see
// packages/mcp/src/server.ts); only the ids, links and viewers are examples.

export interface Exchange {
  /** Optional time marker above the row, e.g. "the next morning". */
  when?: string;
  /** What the person typed, in plain words. */
  prompt: string;
  /** The tool the agent reaches for. */
  tool: string;
  /** The headline the tool hands back. */
  result: string;
  /** The quieter second line of the result. */
  note?: string;
}

export function AgentExchange({ exchanges }: { exchanges: Exchange[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper">
      {exchanges.map((x, i) => (
        <div key={x.prompt} className={i > 0 ? 'border-t border-line' : undefined}>
          <div className="px-4 py-4 sm:px-5">
            {x.when ? (
              <p className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-graphite">
                {x.when}
              </p>
            ) : null}
            <p className="flex gap-2 text-[14.5px] leading-relaxed text-ink">
              <span aria-hidden className="select-none font-mono text-signal-dark">
                &rsaquo;
              </span>
              <span className="min-w-0">{x.prompt}</span>
            </p>
          </div>
          <div className="border-t border-line bg-paper-2/40 px-4 py-4 sm:px-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-signal-dark">
              {x.tool}
            </p>
            <p className="mt-2 font-mono text-[12.5px] leading-relaxed text-ink [overflow-wrap:anywhere]">
              {x.result}
            </p>
            {x.note ? (
              <p className="mt-1.5 font-mono text-[12.5px] leading-relaxed text-graphite [overflow-wrap:anywhere]">
                {x.note}
              </p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
