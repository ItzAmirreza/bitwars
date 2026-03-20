import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'child_process'

const GIT_META_PATH = '/__bitwars_git_meta'

function git(cmd: string): string {
  try { return execSync(cmd, { encoding: 'utf-8' }).trim() }
  catch { return 'unknown' }
}

function gitMetaPlugin() {
  return {
    name: 'bitwars-git-meta-endpoint',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        const url = typeof req.url === 'string' ? req.url : ''
        if (!url.startsWith(GIT_META_PATH)) {
          next()
          return
        }

        const payload = JSON.stringify({
          gitBranch: git('git rev-parse --abbrev-ref HEAD'),
          gitCommit: git('git rev-parse --short HEAD'),
          sampledAt: new Date().toISOString(),
        })

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
        res.end(payload)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), gitMetaPlugin()],
  define: {
    __GIT_BRANCH__: JSON.stringify(git('git rev-parse --abbrev-ref HEAD')),
    __GIT_COMMIT__: JSON.stringify(git('git rev-parse --short HEAD')),
  },
})
