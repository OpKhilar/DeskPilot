import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Deep rich rust-brown — primary brand / accent
        brand: {
          50: "#FAF0E9",
          100: "#F3DDCE",
          200: "#E6BCA0",
          300: "#D4956E",
          400: "#B96B3D",
          500: "#733015",
          600: "#632913",
          700: "#522210",
          800: "#3F1B0D",
          900: "#2C130A",
          DEFAULT: "#733015",
        },
        // Soft warm cream — highlights, badges, soft surfaces
        cream: {
          50: "#FDF8EE",
          100: "#F9EFD8",
          200: "#F5E1BE",
          300: "#EAD3A6",
          400: "#D8BE8C",
          DEFAULT: "#F5E1BE",
        },
        // Dark charcoal — app background
        charcoal: {
          950: "#0C0807",
          900: "#120D0B",
          850: "#17110E",
          800: "#1E1713",
          700: "#2A211B",
          600: "#3A2D25",
          500: "#4C3B30",
          DEFAULT: "#120D0B",
        },
        ash: {
          400: "#9C8B7E",
          300: "#B7A79A",
          200: "#D2C6BB",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0, 0, 0, 0.35), 0 12px 32px -18px rgba(0, 0, 0, 0.9)",
        glow: "0 0 0 1px rgba(245, 225, 190, 0.08), 0 18px 44px -24px rgba(115, 48, 21, 0.9)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
