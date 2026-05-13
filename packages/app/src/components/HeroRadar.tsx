// HeroRadar: three concentric rings, slow sweep, fixed pings.
// SVG + CSS keyframes only, no JS animation loop. prefers-reduced-motion
// freezes the timeline via the global CSS rule. One calm rotation per 12s.

import { useId } from 'react';

interface HeroRadarProps {
  size?: number;
  className?: string;
}

const RING_RADII = [80, 130, 170]; // in 360-unit coordinates
const PINGS: { angle: number; radius: number; r: number; delay: string }[] = [
  { angle: 22, radius: 170, r: 3.5, delay: '0s' },
  { angle: 78, radius: 130, r: 4.5, delay: '1.6s' },
  { angle: 145, radius: 170, r: 3.5, delay: '3.1s' },
  { angle: 200, radius: 80, r: 4, delay: '4.7s' },
  { angle: 268, radius: 170, r: 5, delay: '6.3s' },
  { angle: 318, radius: 130, r: 4, delay: '8.4s' },
  { angle: 50, radius: 80, r: 3.5, delay: '10.1s' },
];

export function HeroRadar({ size = 360, className }: HeroRadarProps) {
  const gradientId = useId();
  const cx = 180;
  const cy = 180;

  return (
    <svg
      aria-hidden
      viewBox="0 0 360 360"
      width={size}
      height={size}
      className={className}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2="0"
          y2="180"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#7A1F2E" stopOpacity="0.42" />
          <stop offset="55%" stopColor="#7A1F2E" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#7A1F2E" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* concentric rings */}
      {RING_RADII.map((r, i) => (
        <circle
          key={r}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#7A1F2E"
          strokeWidth={1}
          opacity={0.26 - i * 0.07}
        />
      ))}

      {/* compass tick marks at 0/90/180/270 — adds the "instrument" cue */}
      {[0, 90, 180, 270].map((a) => {
        const rad = ((a - 90) * Math.PI) / 180;
        const outer = 170;
        const inner = 162;
        return (
          <line
            key={a}
            x1={cx + Math.cos(rad) * inner}
            y1={cy + Math.sin(rad) * inner}
            x2={cx + Math.cos(rad) * outer}
            y2={cy + Math.sin(rad) * outer}
            stroke="#7A1F2E"
            strokeWidth={1}
            opacity={0.35}
          />
        );
      })}

      {/* rotating sweep wedge */}
      <g className="hero-radar-sweep" style={{ transformOrigin: '180px 180px' }}>
        <path
          d={`M ${cx} ${cy} L ${cx} ${cy - 170} A 170 170 0 0 1 ${cx + 170 * Math.sin((36 * Math.PI) / 180)} ${cy - 170 * Math.cos((36 * Math.PI) / 180)} Z`}
          fill={`url(#${gradientId})`}
        />
        <line
          x1={cx}
          y1={cy}
          x2={cx}
          y2={cy - 170}
          stroke="#7A1F2E"
          strokeWidth={1.25}
          strokeOpacity={0.7}
          strokeLinecap="round"
        />
      </g>

      {/* pings */}
      {PINGS.map((p) => {
        const rad = ((p.angle - 90) * Math.PI) / 180;
        const x = cx + Math.cos(rad) * p.radius;
        const y = cy + Math.sin(rad) * p.radius;
        return (
          <g key={p.delay} className="hero-radar-ping" style={{ animationDelay: p.delay }}>
            <circle cx={x} cy={y} r={p.r * 2.4} fill="#7A1F2E" opacity={0.18} />
            <circle cx={x} cy={y} r={p.r} fill="#7A1F2E" />
          </g>
        );
      })}

      {/* center dot */}
      <circle cx={cx} cy={cy} r={3} fill="#7A1F2E" />
      <circle cx={cx} cy={cy} r={6} fill="none" stroke="#7A1F2E" strokeWidth={1} opacity={0.5} />
    </svg>
  );
}
