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
          DEFAULT: '#1e40af',
          dark: '#1e3a8a',
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
