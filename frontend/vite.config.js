import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execFileSync } from 'child_process'

const gitHash = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim().slice(0, 7)

export default defineConfig({
  define: {
    __GIT_HASH__: JSON.stringify(gitHash),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8788',
    },
  },
})
