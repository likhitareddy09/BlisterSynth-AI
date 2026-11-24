/** Colours come from CSS variables (src/index.css) so light and dark mode share one set of class names. */
const c = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: c("bg"), surface: c("surface"), tint: c("tint"), line: c("line"),
        primary: c("primary"), "on-primary": c("on-primary"),
        sage: c("sage"), mint: c("mint"), teal: c("teal"),
        ink: c("ink"), soft: c("soft"),
        rust: c("rust"), ok: c("ok"), warn: c("warn"), bad: c("bad"), deep: c("deep"),
        pastel: { green: c("pastel-green"), sand: c("pastel-sand"), blue: c("pastel-blue"), rose: c("pastel-rose") },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans Variable"', "system-ui", "sans-serif"],
        sans: ['"Inter Variable"', "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", '"Liberation Mono"', "monospace"],
      },
      borderRadius: { "4xl": "2rem", "5xl": "2.5rem" },
      boxShadow: {
        card: "0 1px 2px rgb(23 65 53 / 0.05), 0 8px 24px -12px rgb(23 65 53 / 0.12)",
        float: "0 10px 40px -10px rgb(23 65 53 / 0.35)",
      },
    },
  },
  plugins: [],
};
