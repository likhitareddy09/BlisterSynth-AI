import type { HTMLAttributes, ReactNode } from "react";

export type Tint = "none" | "green" | "sand" | "blue" | "rose";
const TINTS: Record<Tint, string> = {
  none: "bg-surface", green: "bg-pastel-green", sand: "bg-pastel-sand", blue: "bg-pastel-blue", rose: "bg-pastel-rose",
};

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode; actions?: ReactNode; tint?: Tint; padded?: boolean;
}

/** White rounded card. `tint` gives the soft pastel look used by the bento tiles; `foil` adds the faint pointer-following shine.
 *  `min-w-0` lets a card shrink inside a grid or flex row, so a sideways scroller inside it (chips, wide tables) scrolls instead of widening the page on phones. */
export function Card({ title, actions, tint = "none", padded = true, className = "", children, ...rest }: CardProps) {
  return (
    <section className={`foil min-w-0 rounded-3xl shadow-card ${TINTS[tint]} ${padded ? "p-5" : ""} ${className}`} {...rest}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h3 className="text-base font-semibold">{title}</h3>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
