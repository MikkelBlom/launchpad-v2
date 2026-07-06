/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/web/index.html', './src/web/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm, calm light-mode palette (light mode only — no dark theme, by design)
        ink: {
          DEFAULT: '#1c1917',
          soft: '#57534e',
          faint: '#a8a29e'
        },
        surface: {
          0: '#ffffff',
          1: '#faf9f7',
          2: '#f2f0ec'
        },
        line: '#e7e5e4',
        brand: {
          DEFAULT: '#2e7d50',
          soft: '#e7f0ea',
          strong: '#1f5c3a'
        }
      }
    }
  },
  plugins: []
}
