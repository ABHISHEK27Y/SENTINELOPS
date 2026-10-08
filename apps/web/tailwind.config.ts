import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Dark SRE console palette.
        base: '#0b0e14',
        panel: '#12161f',
        panel2: '#1a1f2b',
        border: '#232936',
        muted: '#8b95a7',
        text: '#e6e9ef',
        accent: '#4f9cf9',
        healthy: '#3fb950',
        warning: '#d29922',
        critical: '#f85149',
        info: '#58a6ff',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
