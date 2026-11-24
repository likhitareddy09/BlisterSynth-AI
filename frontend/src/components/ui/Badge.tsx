import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "green" | "amber" | "red" | "teal" | "dark";
const TONES: Record<BadgeTone, string> = {
  neutral: "bg-tint text-soft",
  green: "bg-ok/15 text-ok",
  amber: "bg-warn/15 text-warn",
  red: "bg-rust/15 text-rust",
  teal: "bg-teal/15 text-teal",
  dark: "bg-primary text-on-primary",
};

/** Small rounded pill: status tags, the badge above the hero headline, etc. */
export function Badge({ tone = "neutral", children, className = "", icon }: {
  tone?: BadgeTone; children: ReactNode; className?: string; icon?: ReactNode;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONES[tone]} ${className}`}>
      {icon}{children}
    </span>
  );
}
export const Pill = Badge;
