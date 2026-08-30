// Directory listings that require a backlink or a badge on our own site
// before they will publish (or keep) the listing. One discreet row at the
// bottom of the footer, sized so it reads as a credit line rather than a
// promo strip.
//
// Twelve Tools: their free tier requires "a link to https://twelve.tools on
// your homepage or footer". Their own badge page says a plain text link is
// accepted in place of the image, so this is a text link. The link they
// verify must be dofollow, so no `rel="nofollow"` and no `sponsored` here.

const MARK_TEXT =
  'font-mono text-[10px] uppercase tracking-[0.16em] text-graphite opacity-70 transition-opacity hover:opacity-100';

export function ListedOn() {
  return (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
        Listed on
      </span>

      <a href="https://twelve.tools" target="_blank" rel="noopener" className={MARK_TEXT}>
        Twelve Tools
      </a>
    </div>
  );
}
