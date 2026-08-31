// RecipientFlow — three-panel horizontal flow.
//
// Goes horizontal at xl rather than lg: three panels plus two arrows need more
// than a max-w-3xl article column, and at lg the third panel ran off the right
// edge of /for/claude-artifacts. Below xl the panels stack, which fits any
// column width.
// Shows the end-to-end recipient experience: the email notification
// firing for the sender, the tracked-link browser frame with the gate,
// and the rendered document with the chrome footer.

import { ArrowRight } from 'lucide-react';
import { EmailNotificationMock } from './EmailNotificationMock';

export function RecipientFlow() {
  return (
    <div className="grid grid-cols-1 items-center gap-y-6 xl:grid-cols-[1fr_auto_1fr_auto_1fr] xl:gap-x-3">
      <FlowPanel
        title="The link arrives"
        body="Marc opens the tracked share from his inbox. Three seconds later the sender's notification fires."
      >
        <EmailNotificationMock variant="card" />
      </FlowPanel>

      <FlowArrow />

      <FlowPanel
        title="Email gate"
        body="A lightweight gate captures the recipient's email before the document renders. Optional password or domain allow-list per share."
      >
        <BrowserFrame>
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
              Marc · please enter your email
            </span>
            <div className="w-full max-w-[200px] rounded-md border border-line bg-paper px-3 py-2 font-mono text-[12px] text-ink">
              marc<span className="opacity-50">@example.com</span>
              <span className="ml-0.5 inline-block h-[14px] w-[1px] translate-y-[2px] bg-ink-soft align-middle" />
            </div>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              className="rounded-md bg-signal px-3 py-1.5 text-[11px] font-medium text-paper"
            >
              View document
            </button>
          </div>
        </BrowserFrame>
      </FlowPanel>

      <FlowArrow />

      <FlowPanel
        title="The document renders"
        body="The original HTML, untouched. Section dwell tracked from this point on. The sender's dashboard fills with reads in real time."
      >
        <BrowserFrame>
          <div className="space-y-1.5 px-3 py-3">
            <div className="h-2 w-[55%] rounded-sm bg-paper-3" />
            <div className="h-1.5 w-[82%] rounded-sm bg-paper-2" />
            <div className="h-1.5 w-[74%] rounded-sm bg-paper-2" />
            <div className="h-1.5 w-[80%] rounded-sm bg-paper-2" />
            <div className="mt-2 h-2 w-[40%] rounded-sm bg-paper-3" />
            <div className="h-1.5 w-[70%] rounded-sm bg-paper-2" />
          </div>
        </BrowserFrame>
      </FlowPanel>
    </div>
  );
}

function FlowPanel({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-serif text-[22px] leading-snug text-ink">{title}</h3>
        <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-soft">{body}</p>
      </div>
      {children}
    </div>
  );
}

function FlowArrow() {
  return (
    <div aria-hidden className="flex items-center justify-center text-graphite lg:py-0">
      <span className="hidden h-px w-6 bg-line lg:block" />
      <ArrowRight className="size-4 lg:mx-1" />
      <span className="hidden h-px w-6 bg-line lg:block" />
    </div>
  );
}

function BrowserFrame({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-paper shadow-[0_18px_30px_-24px_rgba(31,17,8,0.2)]">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5">
        <span className="size-1.5 rounded-full bg-paper-3" />
        <span className="size-1.5 rounded-full bg-paper-3" />
        <span className="size-1.5 rounded-full bg-paper-3" />
        <span className="ml-2 truncate font-mono text-[9px] text-graphite">
          htmlradar.page/r/swift-falcon-a3f2
        </span>
      </div>
      <div className="min-h-[120px]">{children}</div>
      {footer && (
        <div className="flex items-center justify-between border-t border-line bg-paper-2/40 px-3 py-1.5">
          {footer}
        </div>
      )}
    </div>
  );
}
