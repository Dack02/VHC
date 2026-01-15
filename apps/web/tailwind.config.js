/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'var(--brand-primary, #3B82F6)',
          hover: 'var(--brand-primary-hover, #2563EB)',
          light: 'var(--brand-primary-light, #93C5FD)',
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
      borderRadius: {
        none: '0',
      }
    },
  },
  plugins: [],
}
