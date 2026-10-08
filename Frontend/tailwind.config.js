/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F0F9FF',
          100: '#E0F2FE',
          500: '#0284C7',
          600: '#0284C7',
          900: '#0C4A6E',
        },
        status: {
          completed: '#10B981', // Emerald
          inProgress: '#F59E0B', // Amber
          delayed: '#EF4444',    // Rose Red
          notStarted: '#6B7280'  // Slate Gray
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
