// The outreach card's cream, ink and deep red tokens, with local slide labels.
// Every number is fictional; totals are sums of the displayed section times.
const READERS = ['Northgate Capital', 'Harbour & Co', 'M. Okafor'];
const SECONDS = [
  [58, 82, 46],
  [71, 69, 0],
  [64, 44, 0],
  [52, 0, 0],
  [31, 0, 0],
];
const duration = (seconds: number) =>
  seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;

export function SampleReport({ titles }: { titles: string[] }) {
  const named = titles.filter((title) => !/^Slide \d+: Untitled$/.test(title));
  const sections = (named.length ? named : titles).slice(0, 5);
  return (
    <section
      aria-label="Sample read report"
      className="mt-8 rounded-xl border border-line bg-paper p-4 text-ink-soft sm:p-6"
    >
      <h3 className="font-serif text-[26px] leading-tight text-ink sm:text-[32px]">
        A read report for your deck
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed">
        Three fictional readers. Active reading time for the sections shown.
      </p>
      <div className="mt-5 rounded-lg border border-line bg-[#FDF7F0] px-3 py-4 sm:px-5">
        <table className="w-full table-fixed border-collapse text-left text-[12px] sm:text-[13px]">
          <caption className="sr-only">Sample active reading time per slide and reader</caption>
          <thead>
            <tr className="border-b border-line align-top">
              <th scope="col" className="w-[31%] pb-4 pr-2 font-medium">
                Your slides
              </th>
              {READERS.map((reader, column) => (
                <th key={reader} scope="col" className="pb-4 pl-2 font-medium">
                  <span className="block break-words text-signal-dark">{reader}</span>
                  <span className="mt-2 block font-normal tabular-nums">
                    {3 - column} {column === 2 ? 'open' : 'opens'}
                  </span>
                  <span className="mt-1 block font-normal tabular-nums">
                    {duration(
                      sections.reduce((total, _, row) => total + SECONDS[row]![column]!, 0),
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((title, row) => (
              <tr key={row}>
                <th scope="row" dir="auto" className="break-words py-3 pr-2 align-top font-normal">
                  {title}
                </th>
                {READERS.map((reader, column) => {
                  const seconds = SECONDS[row]![column]!;
                  return (
                    <td key={reader} className="py-3 pl-2 align-top">
                      <span className="block tabular-nums">
                        {seconds ? duration(seconds) : '—'}
                      </span>
                      <span
                        aria-hidden
                        className="mt-2 block h-1.5 overflow-hidden rounded-full bg-paper-2"
                      >
                        <span
                          className="block h-full rounded-full bg-signal-dark"
                          style={{ width: `${(seconds / 82) * 100}%` }}
                        />
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-[12px] text-signal-dark">sample numbers, your slides</p>
      <p className="mt-2 text-[12px] leading-relaxed">
        Active reading time stops counting after five seconds without input.
      </p>
    </section>
  );
}
