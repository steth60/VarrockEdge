import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: [path.resolve(__dirname, 'test/setup.ts')],
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // tests share an in-memory DB
      },
    },
    coverage: {
      reporter: ['text', 'html'],
      include: ['server/src/**/*.ts', 'web/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.ts', '**/migrations/**'],
    },
  },
});
