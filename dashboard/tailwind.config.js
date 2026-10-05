/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.ts"],
  theme: {
    extend: {
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
      },
    },
  },
  plugins: [],
};