import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'

// The build stamp: the short commit hash and the build time. It is written into the app and into /version.json, so a page that is
// already open can ask the server whether a newer build exists. (Kept from the old project: the UI reads __BUILD_ID__ and __BUILD_TIME__.)
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA || (() => { try { return execSync('git rev-parse HEAD').toString().trim() } catch { return 'dev' } })()).slice(0, 7)
const BUILD_TIME = new Date().toISOString()
function buildStampPlugin(): Plugin {
  return {
    name: 'build-stamp',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID, time: BUILD_TIME }) + '\n' })
    },
  }
}

// The old project's Figma plugins (site config, error overlay replay, refresh fallback, make kit) and Vercel Speed Insights are left out.
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [react(), buildStampPlugin(), tailwindcss()],
})
