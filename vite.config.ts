import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages のサブパス（/rsvp-bunko/）でも動くよう相対パスで出力する
  base: './',
  worker: { format: 'es' },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
});
