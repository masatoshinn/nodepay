/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dae5ff',
          200: '#bdd0ff',
          300: '#8fb1ff',
          400: '#5a86fc',
          500: '#355ef5',
          600: '#1f3ee9',
          700: '#182fd6',
          800: '#1a29ac',
          900: '#1c2986',
          950: '#141a52',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
