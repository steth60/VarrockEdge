import type { Config } from 'tailwindcss';
import path from 'node:path';

const here = __dirname;

const config: Config = {
  content: [
    path.join(here, 'index.html'),
    path.join(here, 'src/**/*.{ts,tsx}'),
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular'],
      },
    },
  },
  plugins: [],
};

export default config;
