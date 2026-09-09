import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { pageMeta } from '@/lib/seo';
import { serverClient } from '@/lib/supabase-server';
import { createStagedDocument } from '@/app/(app)/new/actions';
import { ConvertPanel } from './ConvertPanel';

export const runtime = 'edge';
export const metadata = pageMeta({
  title: 'PDF to Web Page (Free, In Your Browser) | HTMLRadar',
  description:
    'Turn a landscape PDF deck into one HTML web page, with slide images and a table of contents. Convert and download in your browser for free. Sign in for a tracked link.',
  path: '/convert',
});

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
          Turn a PDF deck into a web page.
        </h1>
        <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
          Choose a landscape PDF deck. Download the HTML file, or sign in to create a tracked link.
        </p>
        <ConvertPanel action={createStagedDocument} resumeToken={resumeToken} signedIn={signedIn} />
      </main>
      <V2Footer />
    </>
  );
}
