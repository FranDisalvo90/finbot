/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        dark: {
          bg: "#0F1117",
          card: "#1A1D27",
          border: "#2A2D37",
          hover: "#252830",
        },
      },
    },
  },
  plugins: [],
};
