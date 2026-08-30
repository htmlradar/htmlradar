// Copy-pasteable command / config block. Same visual treatment as the code
// blocks in the engineering blog post, lifted into a component because the
// /mcp and /for/claude-code pages are mostly install instructions.

export function CodeBlock({ label, code }: { label?: string; code: string }) {
  return (
    <div className="my-4 overflow-hidden rounded-xl border border-line bg-paper-2/40">
      {label ? (
        <div className="border-b border-line bg-paper-2/60 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          {label}
        </div>
      ) : null}
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.55] text-ink">
        {code}
      </pre>
    </div>
  );
}
