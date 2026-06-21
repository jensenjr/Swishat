import { useId } from "react";

// Shared brand mark. A unique gradient id per instance avoids SVG id clashes
// when several logos render on the same page.
export default function SwishLogo({ size = 32 }) {
  const gid = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5B3FA8" />
          <stop offset="45%" stopColor="#0099CC" />
          <stop offset="100%" stopColor="#FF8C3B" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="10" fill={`url(#${gid})`} />
      <path
        d="M9 22C9 22 12 14 18 14C21 14 22.5 16 24 16C26 16 27 14 27 14"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M9 18C9 18 12 10 18 10C21 10 22.5 12 24 12C26 12 27 10 27 10"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        opacity="0.45"
      />
    </svg>
  );
}
