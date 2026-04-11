import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const GIT_META_PATH = '/__bitwars_git_meta'
const BUILD_META_PATH = '/bitwars-build.json'
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
const EXPECTED_SERVER_BUILD_ENV_KEYS = [
  'BITWARS_EXPECTED_SERVER_BUILD',
  'BITWARS_SERVER_BUILD_COMMIT',
]
const configDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(configDir, '..')
const serverBuildManifestPath = path.resolve(
  configDir,
  'public',
  'bitwars-server-build.json',
)

function git(cmd: string, cwd = process.cwd()): string {
  try { return execSync(cmd, { cwd, encoding: 'utf-8' }).trim() }
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

function resolveExpectedServerBuild(): string {
  const fromEnv = shortCommit(readBuildEnv(EXPECTED_SERVER_BUILD_ENV_KEYS))
  if (fromEnv) return fromEnv

  try {
    const manifest = JSON.parse(fs.readFileSync(serverBuildManifestPath, 'utf-8')) as {
      serverBuild?: string
    }
    const fromManifest = shortCommit(manifest.serverBuild?.trim())
    if (fromManifest) return fromManifest
  } catch {
    // Fall back to git history for local dev if the manifest is missing.
  }

  const fromGitHistory = shortCommit(
    git('git log -1 --format=%H HEAD -- server shared/game-constants.json', repoRoot),
  )
  return fromGitHistory ?? 'unknown'
}

const buildBranch = resolveBuildBranch()
const buildCommit = resolveBuildCommit()
const expectedServerBuild = resolveExpectedServerBuild()
const buildSampledAt = new Date().toISOString()

function buildMetaPayload(): string {
  return JSON.stringify({
    gitBranch: buildBranch,
    gitCommit: buildCommit,
    clientBuild: buildCommit,
    expectedServerBuild,
    sampledAt: buildSampledAt,
  })
}

function buildMetaPlugin(): Plugin {
  return {
    name: 'bitwars-build-meta',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        const url = typeof req.url === 'string' ? req.url : ''
        if (url.startsWith(GIT_META_PATH)) {
          const payload = JSON.stringify({
            gitBranch: buildBranch,
            gitCommit: buildCommit,
            sampledAt: new Date().toISOString(),
          })

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
          res.end(payload)
          return
        }

        if (!url.startsWith(BUILD_META_PATH)) {
          next()
          return
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
        res.end(buildMetaPayload())
      })
    },
    generateBundle(this: {
      emitFile: (asset: {
        type: 'asset';
        fileName: string;
        source: string;
      }) => void;
    }) {
      this.emitFile({
        type: 'asset',
        fileName: BUILD_META_PATH.slice(1),
        source: buildMetaPayload(),
      })
    },
  }
}

function inlineMainCssPlugin(): Plugin {
  return {
    name: 'bitwars-inline-main-css',
    apply: 'build',
    writeBundle(options, bundle) {
      const outDir = options.dir ?? path.resolve(configDir, 'dist')
      const indexHtmlPath = path.resolve(outDir, 'index.html')
      if (!fs.existsSync(indexHtmlPath)) {
        return
      }

      let html = fs.readFileSync(indexHtmlPath, 'utf-8')

      html = html.replace(
        /<link rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/g,
        (tag, href: string) => {
          const fileName = href.startsWith('/') ? href.slice(1) : href
          const cssAsset = bundle[fileName]
          if (!cssAsset || cssAsset.type !== 'asset') {
            return tag
          }

          const cssSource = typeof cssAsset.source === 'string'
            ? cssAsset.source
            : Buffer.from(cssAsset.source).toString('utf-8')

          return `<style>${cssSource}</style>`
        },
      )

      fs.writeFileSync(indexHtmlPath, html)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), buildMetaPlugin(), inlineMainCssPlugin()],
  define: {
    __GIT_BRANCH__: JSON.stringify(buildBranch),
    __GIT_COMMIT__: JSON.stringify(buildCommit),
    __EXPECTED_SERVER_BUILD__: JSON.stringify(expectedServerBuild),
  },
})
