import type { Config } from "tailwindcss";
// Tokens de diseño de Texas Top Roofing CRM
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#D71920", dark: "#B3141A", soft: "#FDECEC" },
        night: { DEFAULT: "#111318", 2: "#1A1D24", 3: "#262A33" },
        ink: "#17191F",
        muted: "#667085",
        line: "#E6E8EC",
        canvas: "#F6F7F9",
      },
      fontFamily: { sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"] },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)",
        pop: "0 12px 32px -8px rgba(16,24,40,.24)",
      },
    },
  },
  plugins: [],
};
export default config;
