import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/engine/**/*.test.ts', 'tests/server/**/*.test.ts'],
    testTimeout: 20000,
  },
});
