// Visible FAQ block + matching FAQPage JSON-LD in one component, so
// the schema can never drift from the on-page answers (Google only
// honors FAQ markup whose content is visible on the page).

import { FaqLd, type FaqItem } from './JsonLd';

export function Faq({ items, title = 'Common questions' }: { items: FaqItem[]; title?: string }) {
  return (
    <section className="mt-14">
      <FaqLd items={items} />
      <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">{title}</h2>
      <dl className="mt-5 space-y-6">
        {items.map(({ q, a }) => (
          <div key={q}>
            <dt className="text-[16px] font-medium text-ink">{q}</dt>
            <dd className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">{a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
