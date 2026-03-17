import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "#0b1020",
        foreground: "#f8fafc",
        card: "#131a2e",
        border: "#26304d",
        accent: "#3b82f6",
        accentHover: "#2563eb",
        muted: "#94a3b8",
        success: "#22c55e",
        danger: "#ef4444"
      },
      boxShadow: {
        soft: "0 10px 30px rgba(0, 0, 0, 0.25)"
      }
    }
  },
  plugins: []
};

export default config;