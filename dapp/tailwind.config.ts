import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        stellar: {
          blue: "#14395e",
          dark: "#0b1f35",
          light: "#65b3ff",
          accent: "#00d4ff",
        },
      },
    },
  },
  plugins: [],
};

export default config;
