import { cn } from "@/lib/utils";

/**
 * RentID emblem — a house enclosing an ID card, drawn in the brand coral
 * gradient. Pure SVG so it stays crisp at nav sizes and inherits sizing.
 */
export function RentIDMark({ className }: { className?: string | undefined }) {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label="RentID" className={cn("size-7", className)}>
      <defs>
        <linearGradient id="rentid-mark" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="var(--brand-gradient-from)" />
          <stop offset="100%" stopColor="var(--brand-gradient-to)" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#rentid-mark)" strokeLinecap="round" strokeLinejoin="round">
        <path strokeWidth="5.5" d="M6 27.5 32 6l26 21.5" />
        <path strokeWidth="5.5" d="M11.5 30v22.5a3 3 0 0 0 3 3h35a3 3 0 0 0 3-3V30" />
        <rect x="19" y="27" width="26" height="19" rx="4" strokeWidth="3.4" />
        <circle cx="28" cy="34.5" r="3.2" strokeWidth="3" />
        <path strokeWidth="3" d="M23.6 42.4c.9-2.4 2.5-3.6 4.4-3.6s3.5 1.2 4.4 3.6" />
        <path strokeWidth="3" d="M36.5 33.6h4.6M36.5 39.4h4.6" />
      </g>
    </svg>
  );
}

export function RentIDWordmark({ className }: { className?: string | undefined }) {
  return (
    <span className={cn("font-display font-bold tracking-tight", className)}>
      Rent<span className="text-accent">ID</span>
    </span>
  );
}

export function RentIDLogo({
  className,
  markClassName,
  wordmarkClassName,
}: {
  className?: string | undefined;
  markClassName?: string | undefined;
  wordmarkClassName?: string | undefined;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <RentIDMark className={markClassName} />
      <RentIDWordmark className={wordmarkClassName} />
    </span>
  );
}
