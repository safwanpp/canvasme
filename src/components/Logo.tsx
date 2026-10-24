// canvas.me mark: a "C" drawn on the SETITUP logo's block grid and gradient.
// `id` keeps gradient/mask ids unique when several marks share a page.
export function LogoMark({ size = 24, id = "cm" }: { size?: number; id?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 400 400" fill="none" aria-hidden>
      <defs>
        <linearGradient id={`${id}-g`} x1="200" y1="0" x2="200" y2="400" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9D7FF4" />
          <stop offset="1" stopColor="#0755FF" />
        </linearGradient>
        <mask id={`${id}-m`} maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400">
          <rect width="400" height="400" fill="#fff" />
          <rect x="80" y="92" width="240" height="216" rx="16" fill="#000" />
        </mask>
      </defs>
      <g fill={`url(#${id}-g)`} mask={`url(#${id}-m)`}>
        <rect x="80" y="0" width="240" height="145" rx="16" />
        <rect x="80" y="255" width="240" height="145" rx="16" />
        <rect x="0" y="73" width="120" height="254" rx="16" />
        <rect x="240" y="73" width="160" height="72" rx="16" />
        <rect x="240" y="255" width="160" height="72" rx="16" />
      </g>
    </svg>
  );
}

export function Logo({ size = 22, id, className = "" }: { size?: number; id?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold tracking-[-0.01em] text-ink-900 ${className}`}>
      <LogoMark size={size} id={id} />
      <span>
        canvas<span className="text-accent-500">.me</span>
      </span>
    </span>
  );
}
