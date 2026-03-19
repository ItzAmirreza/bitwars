import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'child_process'

function git(cmd: string): string {
  try { return execSync(cmd, { encoding: 'utf-8' }).trim() }
  catch { return 'unknown' }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __GIT_BRANCH__: JSON.stringify(git('git rev-parse --abbrev-ref HEAD')),
    __GIT_COMMIT__: JSON.stringify(git('git rev-parse --short HEAD')),
  },
})
