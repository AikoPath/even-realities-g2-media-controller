import { defineConfig } from 'vite'
import { execSync } from 'child_process'

const commitHash = execSync('git rev-parse --short HEAD').toString().trim()
const commitMsg = execSync('git log -1 --pretty=%s').toString().trim()

export default defineConfig({
  base: '/even-realities-g2-media-controller/',
  define: {
    __APP_VERSION__: JSON.stringify(`${commitHash} - ${commitMsg}`),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
