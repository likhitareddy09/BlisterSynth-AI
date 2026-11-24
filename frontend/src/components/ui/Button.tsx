import { LoaderCircle } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "pill";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:brightness-110 shadow-sm foil-sheen",
  secondary: "bg-surface text-ink border border-line hover:bg-tint",
  ghost: "text-soft hover:bg-tint hover:text-ink",
  danger: "bg-rust/10 text-rust hover:bg-rust/20",
  pill: "bg-white text-[#174135] hover:bg-white/90 shadow-float",   // white pill CTA used on the green hero
};
const SIZES: Record<ButtonSize, string> = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant; size?: ButtonSize; loading?: boolean; full?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, full, className = "", children, disabled, type = "button", ...rest }, ref,
) {
  return (
    <button
      ref={ref} type={type} disabled={disabled || loading}
      className={`press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${full ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {loading && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
