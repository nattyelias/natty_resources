import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'
import { APP_NAME } from './src/core/config.ts'

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

// The app name lives in src/core/config.ts; index.html carries %APP_NAME% where it belongs (the tab title and the social title).
function appNamePlugin(): Plugin {
  return { name: 'app-name', transformIndexHtml: { order: 'pre', handler: (html: string) => html.replaceAll('%APP_NAME%', APP_NAME) } }
}

// The old project's Figma plugins (site config, error overlay replay, refresh fallback, make kit) and Vercel Speed Insights are left out.
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [react(), buildStampPlugin(), appNamePlugin(), tailwindcss()],
})
