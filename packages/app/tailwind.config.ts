import type { Config } from 'tailwindcss';

// v2 palette — Oxblood accent on warm cream. The warm light theme stays
// (paper, ink, graphite, line from the the company palette image); only the
// accent shifts from Emborange to Oxblood `#7A1F2E`. The intention is to
// keep visual semblance with the company out of the page entirely — same
// warm family, completely different focal color. Oxblood reads as
// editorial / literary press, not tech-bro orange.

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: '#FBF1E8', 2: '#F4E1CB', 3: '#EDD5BD' },
        ink: { DEFAULT: '#1F1108', soft: '#3A2818' },
        graphite: '#876959',
        signal: { DEFAULT: '#7A1F2E', dark: '#5A1521' },
        'signal-soft': '#D9B5B0',
        // Pistachio pop — accent reserved for live indicators and a
        // single "headline stat" highlight per dashboard. Used very
        // sparingly; cream + oxblood remain the default palette.
        // Introduced 2026-05-18 with the /docs/[id] redesign.
        pop: { DEFAULT: '#C9E4A5', ink: '#2F4118' },
        good: '#1F7A3A',
        line: '#E8D5BD',
        alert: '#5A1521',
      },
      fontFamily: {
        // CSS variables wired in app/layout.tsx via next/font (self-hosted).
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.04em',
      },
      keyframes: {
        'reveal-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'radar-pulse': {
          '0%, 100%': { opacity: '0.6', transform: 'scale(0.96)' },
          '50%': { opacity: '1', transform: 'scale(1.02)' },
        },
        // Live-indicator pulse — used by the Live chip and "currently
        // reading" status dots on /docs/[id]. Soft halo grow/fade.
        'live-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(31, 122, 58, 0.4)' },
          '50%': { boxShadow: '0 0 0 6px rgba(31, 122, 58, 0)' },
        },
      },
      animation: {
        // 700ms ease-out with `both` fill-mode so the element starts at the
        // keyframe-0 state (opacity 0) before the delay elapses, and remains
        // at keyframe-100 after. Without `both` the element flashes visible
        // before the delay starts.
        'reveal-up': 'reveal-up 700ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'radar-pulse': 'radar-pulse 3s ease-in-out infinite',
        'live-pulse': 'live-pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
