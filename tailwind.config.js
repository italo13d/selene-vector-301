/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        space: {
          bg: '#090D16',
          card: '#131B2E',
          border: '#1E293B',
          solar: '#F59E0B',
          earth: '#06B6D4',
          psr: '#3B82F6',
          hazard: '#EF4444',
          text: '#F8FAFC',
        }
      },
      fontFamily: {
        heading: ['"Space Grotesk"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
