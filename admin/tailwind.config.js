/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        hw: {
          dark: '#1B5E3B',
          green: '#2E7D4F',
          fresh: '#3D9B5F',
          light: '#E8F5EE',
          gray: '#F5F6F7',
          text: '#1A1A1A',
          muted: '#6B7280',
        },
      },
      fontFamily: {
        sans: ['"Source Sans 3"', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['"Outfit"', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
