import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Integration tests only: files in __tests__ directory
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['node_modules/**'],
  }
});
