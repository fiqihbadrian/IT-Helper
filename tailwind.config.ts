import type { Config } from "tailwindcss";

/**
 * Colours point at the CSS custom properties declared in `app/globals.css`.
 * Channels are space separated so the opacity modifier keeps working, which is
 * why these are `rgb(var(--x) / <alpha-value>)` rather than plain `var(--x)`.
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: token("surface"),
          muted: token("surface-muted"),
          border: token("surface-border"),
        },
        ink: {
          DEFAULT: token("ink"),
          muted: token("ink-muted"),
          subtle: token("ink-subtle"),
        },
        accent: {
          DEFAULT: token("accent"),
          hover: token("accent-hover"),
          soft: token("accent-soft"),
        },
        danger: {
          DEFAULT: token("danger"),
          ink: token("danger-ink"),
          soft: token("danger-soft"),
          border: token("danger-border"),
        },
        success: {
          DEFAULT: token("success"),
          ink: token("success-ink"),
          soft: token("success-soft"),
          border: token("success-border"),
        },
        warning: {
          DEFAULT: token("warning"),
          ink: token("warning-ink"),
          soft: token("warning-soft"),
          border: token("warning-border"),
        },
        info: {
          DEFAULT: token("info"),
          ink: token("info-ink"),
          soft: token("info-soft"),
          border: token("info-border"),
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
      },
      borderRadius: {
        card: "10px",
      },
    },
  },
  plugins: [],
};

export default config;
