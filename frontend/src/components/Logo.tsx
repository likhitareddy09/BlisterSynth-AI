/** BlisterSynth mark: two pills in a rounded square. */
export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-display text-lg font-bold ${className}`}>
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="10" fill="rgb(var(--primary))" />
        <rect x="6" y="12" width="12" height="8" rx="4" fill="#B9CAC7" transform="rotate(-30 12 16)" />
        <circle cx="21.5" cy="16" r="4.5" fill="#7F9783" />
      </svg>
      <span>BlisterSynth <span className="text-teal">AI</span></span>
    </span>
  );
}
