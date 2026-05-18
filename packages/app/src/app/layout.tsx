import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Newsreader, JetBrains_Mono } from 'next/font/google';
import { GeistSans } from 'geist/font/sans';
import { EventTracker } from '@/components/EventTracker';
import './globals.css';

// Newsreader — variable serif for editorial headlines. Less ubiquitous
// than Fraunces in the SaaS-landing-page rotation, more newspaper than
// magazine. Optical-size axis gives us proper display + body shaping.
// Self-hosted via next/font (no CDN flicker, no privacy leak to Google
// Fonts at runtime).
const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-serif',
  axes: ['opsz'],
  display: 'swap',
});

// Geist — Vercel's contemporary grotesque. Used for body, UI, controls.
// Picked over Inter to step out of the SaaS-Inter monoculture without
// paying for a foundry license. Distributed via the `geist` npm package
// rather than Google Fonts (Next 14.2 predates Geist's google-fonts
// inclusion). The package self-hosts the font files, same as next/font.

// JetBrains Mono — kept for kickers, slugs, section marks. Pairs cleanly
// with both Newsreader and Geist.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'HTMLRadar — Document tracking for HTML', template: '%s · HTMLRadar' },
  description:
    'Open-source read tracking for HTML decks, briefs, and proposals. Upload a file or paste a URL, send a tracked link, see who opened it and where they dwelled.',
  metadataBase: new URL('https://htmlradar.com'),
  applicationName: 'HTMLRadar',
  authors: [{ name: 'HTMLRadar' }],
  keywords: [
    'document tracking',
    'html tracking',
    'docsend alternative',
    'pitch deck tracking',
    'section-level dwell',
    'open source docsend',
    'agpl document tracking',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    title: 'HTMLRadar — Document tracking for HTML',
    description:
      'The deck moved to HTML. Tracking should follow. Open-source read tracking for HTML decks, mocks, briefs, and updates. AGPL-3.0.',
    siteName: 'HTMLRadar',
    url: 'https://htmlradar.com',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'HTMLRadar — Document tracking for HTML',
    description:
      'Open-source read tracking for HTML decks, mocks, briefs, and updates. Section-level dwell, per-recipient shares, real-time read notifications.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${newsreader.variable} ${GeistSans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans">
        <EventTracker />
        {children}
      </body>
    </html>
  );
}
