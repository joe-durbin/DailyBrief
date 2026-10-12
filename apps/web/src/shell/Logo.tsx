export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-surface-2" />
      <path d="M16 6l8 10-8 10-8-10z" className="fill-accent" />
      <path d="M16 11l4 5-4 5-4-5z" className="fill-surface-2" />
    </svg>
  );
}
