import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#c8102e", dark: "#9e0c24", soft: "#fdecee" },
      },
    },
  },
  plugins: [],
};
export default config;
