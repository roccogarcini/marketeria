import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist)", "Inter", "system-ui", "sans-serif"],
        serif: ["var(--font-instrument-serif)", "Georgia", "serif"],
        display: ["var(--font-instrument-serif)", "Georgia", "serif"],
        num: ["var(--font-space-grotesk)", "ui-rounded", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        "accent-deep": "hsl(var(--accent-deep))",
        "accent-soft": "hsl(var(--accent-soft))",
        ok: "hsl(var(--ok))",
        warn: "hsl(var(--warn))",
        info: "hsl(var(--info))",
        ch: {
          whatsapp: "hsl(var(--ch-whatsapp))",
          web: "hsl(var(--ch-web))",
          voice: "hsl(var(--ch-voice))",
          instagram: "hsl(var(--ch-instagram))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        salmon: {
          50:  "#FFF5F2",
          100: "#FFE4DB",
          200: "#FFC8B5",
          300: "#FFA085",
          400: "#FA8072",
          500: "#F26A5E",
          600: "#D95548",
          700: "#B24338",
          800: "#8B332B",
          900: "#5C221C",
          950: "#33130F",
        },
        ink: {
          50:  "#F5F4F2",
          100: "#E8E6E2",
          200: "#C9C6BF",
          300: "#9E9A91",
          400: "#736F66",
          500: "#4F4B44",
          600: "#3A3732",
          700: "#2A2824",
          800: "#1C1B18",
          900: "#111110",
          950: "#08070A",
        },
      },
      backgroundImage: {
        "salmon-gradient":
          "linear-gradient(135deg, hsl(8, 87%, 67%), hsl(15, 85%, 55%))",
        "salmon-subtle":
          "linear-gradient(135deg, hsl(8, 40%, 12%), hsl(18, 30%, 8%))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};

export default config;
