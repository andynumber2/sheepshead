import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['shared/**/*.test.{js,ts}'],
    passWithNoTests: true,
  },
})
