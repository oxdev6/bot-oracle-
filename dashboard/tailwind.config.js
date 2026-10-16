/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.ts"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Inter",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "monospace"],
      },
      colors: {
        brand: {
          50: "#eef7ff", 100: "#d9edff", 200: "#bcdfff", 300: "#8ec9ff",
          400: "#59a9ff", 500: "#2f80ed", 600: "#1f60c9", 700: "#1a4da3",
          800: "#1a4385", 900: "#1b396e",
        },
        surface: {
          50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0", 700: "#334155",
          800: "#1e293b", 900: "#0f172a", 950: "#020617",
        },
        ink: {
          950: "#03070f",
          900: "#060d1a",
          850: "#0a1424",
          800: "#0e1b30",
          700: "#16243d",
        },
        accent: {
          DEFAULT: "#22d3ee",
          soft: "#67e8f9",
          deep: "#0891b2",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(34,211,238,0.10), 0 34px 90px -55px rgba(34,211,238,0.65)",
        card: "inset 0 1px 0 0 rgba(255,255,255,0.05), 0 26px 60px -42px rgba(2,6,23,0.95)",
        "card-hover": "inset 0 1px 0 0 rgba(255,255,255,0.08), 0 36px 80px -46px rgba(34,211,238,0.55)",
        inset: "inset 0 1px 0 0 rgba(255,255,255,0.05)",
      },
      backgroundImage: {
        grid: "linear-gradient(to right, rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.05) 1px, transparent 1px)",
        "brand-gradient": "linear-gradient(135deg, #22d3ee 0%, #3b82f6 55%, #6366f1 100%)",
        "sheen": "linear-gradient(110deg, transparent 20%, rgba(255,255,255,0.14) 50%, transparent 80%)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.55s cubic-bezier(0.16, 1, 0.3, 1) both",
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
        shimmer: "shimmer 1.7s infinite",
      },
    },
  },
  plugins: [],
};
