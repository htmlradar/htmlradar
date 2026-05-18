// Tiny inline-SVG sparkline. 12 points across 24h is the default — one
// bucket per 2-hour window. Renders as a polyline with no axis labels
// or grid; meant to be a visual texture inside the feature stat card,
// not a real chart you'd query.

import { cn } from '@/lib/cn';

interface SparklineProps {
  points: number[];
  // Visual width is fluid (100% of container); height is fixed.
  height?: number;
  className?: string;
  // Stroke colour passed through; defaults to white-with-alpha so it
  // reads cleanly against the dark feature card. Pass another value if
  // you ever use this in a paper-card.
  stroke?: string;
}

export function Sparkline({
  points,
  height = 36,
  className,
  stroke = 'rgba(255,255,255,0.85)',
}: SparklineProps) {
  if (points.length === 0) return null;

  // Normalise points to [0, 1] then scale to viewBox coordinates.
  // viewBox uses 0..100 horizontal and 0..height vertical so the SVG
  // scales fluidly with whatever width its container gives it.
  const max = Math.max(...points, 1);
  const step = points.length > 1 ? 100 / (points.length - 1) : 50;
  const coords = points.map((v, i) => {
    const x = i * step;
    const y = height - (v / max) * (height - 4) - 2; // 2px padding top/bottom
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg
      className={cn('block w-full', className)}
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      height={height}
      aria-hidden
    >
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
