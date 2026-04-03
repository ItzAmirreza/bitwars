import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'child_process'

const GIT_META_PATH = '/__bitwars_git_meta'
const BUILD_BRANCH_ENV_KEYS = [
  'BITWARS_BUILD_BRANCH',
  'CF_PAGES_BRANCH',
  'GITHUB_REF_NAME',
]
const BUILD_COMMIT_ENV_KEYS = [
  'BITWARS_BUILD_COMMIT',
  'CF_PAGES_COMMIT_SHA',
  'GITHUB_SHA',
]

function git(cmd: string): string {
  try { return execSync(cmd, { encoding: 'utf-8' }).trim() }
  catch { return 'unknown' }
}

function readBuildEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return undefined
}

function shortCommit(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.slice(0, 7)
}

function resolveBuildBranch(): string {
  return readBuildEnv(BUILD_BRANCH_ENV_KEYS) ?? git('git rev-parse --abbrev-ref HEAD')
}

function resolveBuildCommit(): string {
  return shortCommit(readBuildEnv(BUILD_COMMIT_ENV_KEYS)) ?? git('git rev-parse --short HEAD')
}

const buildBranch = resolveBuildBranch()
const buildCommit = resolveBuildCommit()

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
          gitBranch: buildBranch,
          gitCommit: buildCommit,
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
    __GIT_BRANCH__: JSON.stringify(buildBranch),
    __GIT_COMMIT__: JSON.stringify(buildCommit),
  },
})
