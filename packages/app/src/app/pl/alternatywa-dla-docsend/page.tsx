import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Alternatywa dla DocSend do plików HTML | HTMLRadar',
  description:
    'Szukasz alternatywy dla DocSend? HTMLRadar to otwartoźródłowe śledzenie prezentacji HTML: wiesz, kto otworzył Twój dokument, które sekcje przeczytał i jak długo je czytał.',
  path: '/pl/alternatywa-dla-docsend',
  locale: 'pl_PL',
  languages: {
    en: '/compare/docsend',
    pl: '/pl/alternatywa-dla-docsend',
    'x-default': '/compare/docsend',
  },
});

const FAQ = [
  {
    q: 'Jak sprawdzić, kto otworzył Twój dokument?',
    a: 'Wysyłasz odbiorcy unikalny link śledzący wygenerowany przez HTMLRadar zamiast zwykłego pliku. Gdy odbiorca go otworzy, widzisz to w swoim panelu razem z tym, które sekcje przeczytał i ile czasu na nich spędził.',
  },
  {
    q: 'Czy HTMLRadar jest darmowy?',
    a: 'Tak, dla dwóch śledzonych linków i bez karty płatniczej. Powyżej tego limitu koszt to 15 dolarów miesięcznie lub 150 dolarów rocznie. Kod źródłowy jest dostępny bezpłatnie na licencji AGPL-3.0, a HTMLRadar uruchamiasz na własnych kontach Cloudflare i Supabase.',
  },
  {
    q: 'Czym różni się HTMLRadar od DocSend?',
    a: 'DocSend śledzi przesłane pliki PDF, prezentacje, dokumenty, multimedia i arkusze kalkulacyjne. HTMLRadar śledzi pliki HTML i publiczne adresy URL, jest otwartoźródłowy i można go hostować we własnej infrastrukturze Cloudflare i Supabase.',
  },
];

export default function AlternatywaDlaDocsendPage() {
  return (
    <>
      <NavBar />
      <main lang="pl" className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
          <BreadcrumbLd
            items={[
              { name: 'Strona główna', url: '/' },
              { name: 'Alternatywa dla DocSend', url: '/pl/alternatywa-dla-docsend' },
            ]}
          />
          <SectionMark>HTMLRadar · Porównanie</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            Otwartoźródłowa alternatywa dla DocSend przeznaczona do plików HTML.
          </h1>
          <DirectAnswer updated="sierpień 2026" label="Zaktualizowano:">
            HTMLRadar to otwartoźródłowa alternatywa dla DocSend do plików HTML. Prześlij plik HTML
            lub wklej adres URL, wyślij śledzony link i zobacz, kto go otworzył, które sekcje
            przeczytał i jak długo. Kod źródłowy jest dostępny na licencji AGPL-3.0, więc HTMLRadar
            można hostować samodzielnie. Bezpłatny plan obejmuje dwa śledzone linki, potem 15
            dolarów miesięcznie lub 150 dolarów rocznie.
          </DirectAnswer>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            DocSend to ugruntowany produkt do śledzenia dokumentów, obsługujący pliki PDF,
            prezentacje, dokumenty, multimedia i arkusze kalkulacyjne. HTMLRadar z założenia działa
            inaczej: śledzi pliki HTML i adresy URL, a do tego jest oprogramowaniem
            otwartoźródłowym, które możesz hostować samodzielnie. Jeśli wysyłasz prezentacje w
            formacie HTML, ta różnica ma znaczenie. Jeśli nie, DocSend może być lepszym wyborem.
          </p>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            Śledzenie prezentacji HTML w HTMLRadar nie wymaga konwersji do PDF-a. Dokument zostaje w
            oryginalnym formacie, a Ty widzisz, które nagłówki i slajdy faktycznie przyciągnęły
            uwagę odbiorcy.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Porównanie funkcji
            </h2>
            <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-paper">
              <table className="w-full min-w-[560px] text-[14px]">
                <thead className="bg-paper-2/40 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                  <tr>
                    <th className="px-5 py-3">Funkcja</th>
                    <th className="px-5 py-3">HTMLRadar</th>
                    <th className="px-5 py-3">DocSend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[
                    [
                      'Obsługiwany format',
                      'Pliki HTML lub publiczne adresy URL',
                      'PDF, prezentacje, dokumenty, multimedia i arkusze kalkulacyjne',
                    ],
                    [
                      'Kod źródłowy',
                      'Open source, licencja AGPL-3.0',
                      'Nie jest oprogramowaniem otwartoźródłowym',
                    ],
                    ['Sposób wdrożenia', 'Własne konta Cloudflare i Supabase', 'Usługa hostowana'],
                    [
                      'Szczegółowość analityki',
                      'Czas czytania każdej sekcji lub slajdu',
                      'Analityka na poziomie stron',
                    ],
                    ['Audyt licencji', 'Możesz przeczytać kod źródłowy trackera', 'Nie'],
                  ].map(([feature, htmlradar, docsend]) => (
                    <tr key={feature}>
                      <td className="px-5 py-3.5 align-top text-ink">{feature}</td>
                      <td className="px-5 py-3.5 align-top text-ink-soft">{htmlradar}</td>
                      <td className="px-5 py-3.5 align-top text-ink-soft">{docsend}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Który produkt wybrać
            </h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-paper p-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
                  Wybierz HTMLRadar
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                  Wysyłasz prezentacje, briefy lub oferty jako HTML i chcesz wiedzieć, kto otworzył
                  Twój dokument oraz które sekcje faktycznie przeczytał.
                </p>
              </div>
              <div className="rounded-2xl border border-line bg-paper-2/40 p-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
                  Wybierz DocSend
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                  Wysyłasz pliki PDF, prezentacje, dokumenty biurowe, multimedia lub arkusze
                  kalkulacyjne zamiast HTML-a i nie przeszkadza Ci korzystanie z usługi hostowanej.
                </p>
              </div>
            </div>
          </section>

          <Faq title="Najczęstsze pytania" items={FAQ} />

          <section className="mt-14">
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Śledź prezentację HTML za darmo
            </Link>
            <p className="mt-3 text-[13px] text-graphite">
              Pierwsze 2 śledzone linki za darmo. Bez karty płatniczej. Kod źródłowy AGPLv3 na{' '}
              <a
                href="https://github.com/htmlradar/htmlradar"
                className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
              >
                GitHub
              </a>
              .
            </p>
          </section>

          <div className="mt-20 border-t border-line pt-10">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Powiązane:{' '}
              <Link href="/compare/docsend" className="text-signal-dark hover:underline">
                HTMLRadar a DocSend
              </Link>
              ,{' '}
              <Link href="/compare/papermark" className="text-signal-dark hover:underline">
                HTMLRadar a Papermark
              </Link>
              ,{' '}
              <Link href="/self-hosted" className="text-signal-dark hover:underline">
                śledzenie dokumentów na własnym serwerze
              </Link>
              , oraz{' '}
              <Link href="/use-case/track-html-deck" className="text-signal-dark hover:underline">
                śledzenie prezentacji HTML
              </Link>
              .
            </p>
            <Link
              href="/"
              className="link-slide mt-6 inline-block font-mono text-[12px] uppercase tracking-[0.16em] text-graphite hover:text-signal-dark"
            >
              ← Wróć do strony głównej
            </Link>
          </div>
        </article>
      </main>
      <V2Footer />
    </>
  );
}
