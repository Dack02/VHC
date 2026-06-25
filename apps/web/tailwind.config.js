/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Hanken Grotesk"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        primary: {
          // DEFAULT is expressed as RGB channels so Tailwind opacity modifiers
          // (e.g. `bg-primary/5`, `ring-primary/20`) actually compile. The channels
          // are supplied as `--brand-primary-rgb` by BrandingContext /
          // CustomerPortalContent; the fallback equals #4F46E5.
          DEFAULT: 'rgb(var(--brand-primary-rgb, 79 70 229) / <alpha-value>)',
          hover: 'var(--brand-primary-hover, #4338CA)',
          // `dark` aliases `hover` so the long-standing `*-primary-dark` classes
          // resolve to the darker brand shade instead of emitting no CSS.
          dark: 'var(--brand-primary-hover, #4338CA)',
          light: 'var(--brand-primary-light, #A5B4FC)',
        },
        secondary: {
          DEFAULT: 'var(--brand-secondary, #10B981)',
        },
        rag: {
          green: '#16a34a',
          'green-bg': '#dcfce7',
          amber: '#ca8a04',
          'amber-bg': '#fef9c3',
          red: '#dc2626',
          'red-bg': '#fee2e2',
        }
      },
    },
  },
  plugins: [],
}
