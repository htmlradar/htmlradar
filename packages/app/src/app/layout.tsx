import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Newsreader, JetBrains_Mono } from 'next/font/google';
import { GeistSans } from 'geist/font/sans';
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
  title: { default: "HTMLRadar — Know who's reading.", template: '%s · HTMLRadar' },
  description:
    'Open-source document analytics for HTML. Upload a deck, brief, or proposal. See exactly who read it, how long, and which sections they actually dwelled on.',
  metadataBase: new URL(process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://htmlradar.com'),
  applicationName: 'HTMLRadar',
  authors: [{ name: 'HTMLRadar' }],
  keywords: [
    'document analytics',
    'html tracking',
    'docsend alternative',
    'pitch deck analytics',
    'section-level tracking',
    'open source docsend',
    'agpl document tracking',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    title: "HTMLRadar — Know who's reading.",
    description:
      'Section-level read tracking for HTML decks, briefs, and proposals. Open source under AGPL-3.0. Free for the first 10 documents.',
    siteName: 'HTMLRadar',
    url: process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://htmlradar.com',
  },
  twitter: {
    card: 'summary_large_image',
    title: "HTMLRadar — Know who's reading.",
    description:
      'Open-source document analytics for HTML. Section-level dwell, per-recipient shares, real-time read notifications.',
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
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
