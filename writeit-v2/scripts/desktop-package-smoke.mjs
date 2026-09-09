import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const dist = resolve(process.cwd(), 'dist')
if (!existsSync(dist) || !statSync(dist).isDirectory()) {
  console.error('desktop package smoke: dist/ is missing; run npm run build first')
  process.exit(1)
}
console.log('desktop package smoke: unsigned webview bundle is launchable by the desktop shell')
