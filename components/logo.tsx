import { cn } from "@/lib/utils";

export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      role="img"
      aria-label="Crest logo"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
    >
      <defs>
        <clipPath id="logo-clip">
          <rect x="2" y="2" width="60" height="60" rx="14" />
        </clipPath>
        <linearGradient id="logo-sky" x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#a7f3d0" />
          <stop offset="0.5" stopColor="#6ee7b7" />
          <stop offset="1" stopColor="#34d399" />
        </linearGradient>
      </defs>
      <g clipPath="url(#logo-clip)">
        <rect x="2" y="2" width="60" height="60" fill="url(#logo-sky)" />
        <path d="M2 52 L22 38 L32 44 L52 12 L62 30 L62 62 L2 62 Z" fill="#059669" />
        <path d="M52 12 L32 44 L46 44 Z" fill="#10b981" />
        <path d="M2 52 L22 38 L26 52 Z" fill="#10b981" />
        <path d="M52 12 L46 44 L62 30 Z" fill="#065f46" />
        <path d="M46 44 L62 30 L62 62 L50 62 Z" fill="#047857" />
        <path
          d="M52 12 L58 24 L52 27 L47 22 L44 26 L48 17 Z"
          fill="#ffffff"
        />
        <path
          d="M52 12 L47 45"
          fill="none"
          stroke="#065f46"
          strokeOpacity="0.22"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M9 56 L25 50"
          fill="none"
          stroke="#a7f3d0"
          strokeOpacity="0.32"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d="M33 55 L50 47"
          fill="none"
          stroke="#a7f3d0"
          strokeOpacity="0.22"
          strokeWidth="1"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
