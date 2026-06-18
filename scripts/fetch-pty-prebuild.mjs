// 为已安装的 Electron 版本拉取 node-pty 的预编译二进制(本机无 C++ 编译器)。
// 该包的 GitHub Release 按 Electron ABI 提供 win32-x64 预编译;此脚本用 prebuild-install
// 以 electron runtime 拉取匹配 ABI 的二进制,避免 node-gyp 源码编译。
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const moduleDir = join(
  root,
  'node_modules',
  '@homebridge',
  'node-pty-prebuilt-multiarch'
)
const prebuildBin = join(root, 'node_modules', 'prebuild-install', 'bin.js')

function electronVersion() {
  // 优先用实际安装的 electron 版本
  const installed = join(root, 'node_modules', 'electron', 'package.json')
  if (existsSync(installed)) {
    return JSON.parse(readFileSync(installed, 'utf8')).version
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  return (pkg.devDependencies.electron || '').replace(/[^0-9.]/g, '')
}

if (!existsSync(moduleDir) || !existsSync(prebuildBin)) {
  console.log('[fetch-pty] 依赖尚未就绪,跳过')
  process.exit(0)
}

const ver = electronVersion()
console.log(`[fetch-pty] 为 Electron ${ver} 拉取 node-pty 预编译…`)
try {
  execFileSync(
    process.execPath,
    [prebuildBin, '-r', 'electron', '-t', ver, '--arch', process.arch],
    { cwd: moduleDir, stdio: 'inherit' }
  )
  console.log('[fetch-pty] ✅ 完成')
} catch (e) {
  console.error('[fetch-pty] ❌ 拉取失败:', e.message)
  process.exit(1)
}
