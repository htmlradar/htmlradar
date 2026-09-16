import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { Faq } from '@/components/Faq';
import { pageMeta } from '@/lib/seo';
import { serverClient } from '@/lib/supabase-server';
import { createStagedDocument } from '@/app/(app)/new/actions';
import { ConvertPanel } from './ConvertPanel';

export const runtime = 'edge';
export const metadata = pageMeta({
  title: 'PDF Deck to HTML — Free Browser Converter | HTMLRadar',
  description:
    'Turn a landscape PDF deck into one HTML page in your browser. Download free without an account, or sign in to share your pitch deck as a tracked link.',
  path: '/convert',
});

// Answers are the plan's text verbatim; Faq renders them and the matching
// FAQPage JSON-LD from the same array, so the markup cannot drift.
const FAQ = [
  {
    q: 'What PDFs can I convert?',
    a: 'You can convert landscape PDF decks with 2 to 60 pages and a file size up to 30 MB.',
  },
  {
    q: 'What will I download?',
    a: 'You will download one HTML file containing your slides as images and a Contents block. You can open the file as a web page.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. Conversion and HTML download are free without an account. Creating a tracked link requires sign-in.',
  },
  {
    q: 'Is my PDF uploaded for conversion?',
    a: 'No. Conversion runs entirely in your browser. Creating a tracked link is a separate sharing step after sign-in.',
  },
  {
    q: 'Will my slides become editable web text?',
    a: 'No. Each slide becomes an image. The converter does not recreate slide text as editable HTML text.',
  },
  {
    q: 'How do I share my pitch deck as a link?',
    a: 'Convert your PDF deck, then choose “Get a tracked link” and sign in. The free plan includes 2 tracked links.',
  },
];

export default async function ConvertPage({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string }>;
}) {
  const resumeToken = (await searchParams).resume ?? null;
  const signedIn = Boolean((await serverClient().auth.getUser()).data.user);
  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-[880px] px-4 pb-16 pt-28 md:pb-20 md:pt-32">
        <h1 className="text-letterpress font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
          Turn your PDF deck into an HTML web page.
        </h1>
        <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
          Convert a landscape PDF presentation into one HTML page, with each slide as an image and a
          table of contents. Conversion runs entirely in your browser. Download the file free
          without an account, or sign in to share your pitch deck as a tracked link.
        </p>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
          <strong className="font-medium text-ink">Get a tracked link.</strong> Sign in to share
          your converted deck with a tracked link. The free plan includes 2 tracked links.
        </p>
        <ConvertPanel action={createStagedDocument} resumeToken={resumeToken} signedIn={signedIn} />
        <Faq items={FAQ} />
      </main>
      <V2Footer />
    </>
  );
}
