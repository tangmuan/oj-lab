/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dae5ff',
          200: '#bcd1ff',
          300: '#8eb2ff',
          400: '#5988ff',
          500: '#3462f5',
          600: '#2043e0',
          700: '#1b34b5',
          800: '#1b2f8f',
          900: '#1c2d72',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.18)',
      },
    },
  },
  plugins: [],
};
