import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Unit tests only: files named *.test.ts next to source files
    include: ['src/**/*.test.ts'],
    // Exclude integration tests in __tests__ directory
    exclude: ['src/__tests__/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/__tests__/**'
      ]
    }
  }
});
