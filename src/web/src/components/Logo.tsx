// Launchpad's mark: a delta lifting off a split pad. The pad is broken exactly beneath
// the craft — the gap is the moment of launch, and it's what keeps the mark specific
// rather than a generic caret-over-a-line. Two solid shapes, so it survives 16px.
//
// Geometry lives in a 32×32 box and is mirrored pixel-for-pixel in scripts/make-icon.mjs
// (tray + PWA icons) and src/web/public/favicon.svg — change all three together.

const DELTA = 'M16 5.2 Q18.2 12.5 23 19.6 L16 16 L9 19.6 Q13.8 12.5 16 5.2 Z'

export function LogoMark({
  size = 28,
  className = ''
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="Launchpad"
    >
      <rect width="32" height="32" rx="7.2" className="fill-brand" />
      <path d={DELTA} fill="#ffffff" />
      <rect x="5.2" y="22.4" width="9.2" height="3.4" rx="1.7" fill="#ffffff" />
      <rect x="17.6" y="22.4" width="9.2" height="3.4" rx="1.7" fill="#ffffff" />
    </svg>
  )
}

// Mark + wordmark, for the sidebar header.
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark size={size} />
      <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Launchpad</span>
    </span>
  )
}
