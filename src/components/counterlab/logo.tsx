export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="CounterLab logo"
    >
      <rect width="48" height="48" rx="13" fill="currentColor" />
      <g stroke="var(--color-primary-foreground)" strokeLinecap="round" strokeWidth="2.2">
        <path d="M13 34.5h22" opacity=".45" />
        <path d="M17 30V19.5" opacity=".55" />
        <path d="M24 30V13" />
        <path d="M31 30v-6.5" opacity=".55" />
      </g>
      <circle cx="31" cy="20" r="4.2" fill="none" stroke="var(--color-accent)" strokeWidth="2.2" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark className="h-9 w-9 text-primary" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[1.05rem] font-semibold tracking-tight text-foreground">
          Counter<span className="text-accent">Lab</span>
        </span>
        <span className="label-micro mt-1 text-[0.6rem]">Claim stress testing</span>
      </span>
    </span>
  );
}
