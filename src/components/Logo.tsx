// canvas.me mark: a pixel-art "C" on a 10x10 grid, drawn like the SETITUP mark
// (rounded outer corners, sharp inner steps) with the same gradient.
// `id` keeps gradient ids unique when several marks share a page.
export function LogoMark({ size = 24, id = "cm" }: { size?: number; id?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 400 400" fill="none" aria-hidden>
      <defs>
        <linearGradient id={`${id}-g`} x1="200" y1="0" x2="200" y2="400" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9D7FF4" />
          <stop offset="1" stopColor="#0755FF" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id}-g)`} d="M320.0 8.0L320.0 40.0L352.0 40.0A8 8 0 0 1 360.0 48.0L360.0 80.0L392.0 80.0A8 8 0 0 1 400.0 88.0L400.0 152.0A8 8 0 0 1 392.0 160.0L288.0 160.0A8 8 0 0 1 280.0 152.0L280.0 80.0L160.0 80.0L160.0 112.0A8 8 0 0 1 152.0 120.0L120.0 120.0L120.0 152.0A8 8 0 0 1 112.0 160.0L80.0 160.0L80.0 240.0L112.0 240.0A8 8 0 0 1 120.0 248.0L120.0 280.0L152.0 280.0A8 8 0 0 1 160.0 288.0L160.0 320.0L280.0 320.0L280.0 248.0A8 8 0 0 1 288.0 240.0L392.0 240.0A8 8 0 0 1 400.0 248.0L400.0 312.0A8 8 0 0 1 392.0 320.0L360.0 320.0L360.0 352.0A8 8 0 0 1 352.0 360.0L320.0 360.0L320.0 392.0A8 8 0 0 1 312.0 400.0L128.0 400.0A8 8 0 0 1 120.0 392.0L120.0 360.0L88.0 360.0A8 8 0 0 1 80.0 352.0L80.0 320.0L48.0 320.0A8 8 0 0 1 40.0 312.0L40.0 280.0L8.0 280.0A8 8 0 0 1 0.0 272.0L0.0 128.0A8 8 0 0 1 8.0 120.0L40.0 120.0L40.0 88.0A8 8 0 0 1 48.0 80.0L80.0 80.0L80.0 48.0A8 8 0 0 1 88.0 40.0L120.0 40.0L120.0 8.0A8 8 0 0 1 128.0 0.0L312.0 0.0A8 8 0 0 1 320.0 8.0Z" />
    </svg>
  );
}

export function Logo({
  size = 22,
  id,
  className = "",
  textClassName = "",
}: {
  size?: number;
  id?: string;
  className?: string;
  textClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold tracking-[-0.01em] text-ink-900 ${className}`}>
      <LogoMark size={size} id={id} />
      <span className={textClassName}>
        canvas<span className="text-accent-500">.me</span>
      </span>
    </span>
  );
}
