import type { Config } from "tailwindcss";

const config: Config = {
  // Class-based dark mode: the <html> element gets `class="dark"` when
  // the theme toggle (or the system fallback) wants dark, otherwise the
  // class is absent. This pairs with the `dark:` Tailwind variants
  // sprinkled across cashier and owner layouts. See
  // src/components/ThemeToggle.tsx and src/app/actions/setTheme.ts.
  darkMode: 'class',
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
    },
  },
  plugins: [],
};
export default config;
