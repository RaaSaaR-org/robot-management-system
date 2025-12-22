/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primary Palette (from brand.md)
        'cobalt': {
          DEFAULT: '#2A5FFF',
          50: '#E8EDFF',
          100: '#D1DBFF',
          200: '#A3B7FF',
          300: '#7593FF',
          400: '#476FFF',
          500: '#2A5FFF',
          600: '#0042E6',
          700: '#0032B3',
          800: '#002280',
          900: '#00124D',
        },
        'turquoise': {
          DEFAULT: '#18E4C3',
          50: '#E6FCF8',
          100: '#CCF9F1',
          200: '#99F3E3',
          300: '#66EDD5',
          400: '#33E7C7',
          500: '#18E4C3',
          600: '#12B89C',
          700: '#0D8B76',
          800: '#095E4F',
          900: '#043129',
        },
        'slate-gray': '#1E1F24',
        'soft-white': '#F7F9FB',
        // Secondary Palette
        'steel-gray': '#63687A',
        'midnight-blue': '#0C1440',
        'neon-purple': '#A97BFF',
      },
      fontFamily: {
        'sans': ['Inter', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
        'mono': ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        'brand': '8px',
        'brand-lg': '16px',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-in-left': 'slideInLeft 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        slideInLeft: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
}
