// 从「当前终端」启动生产版应用：  npm run app
//
// 为什么需要它：
//   直接双击便携版是由「资源管理器(explorer)」启动的，进程环境很干净，pwsh 的「自动
//   加载 profile」有时不生效，于是你在 profile.ps1 里定义的 claude / codex 等函数会缺失。
//   用本脚本从你「已经加载过 profile、环境完整」的 PowerShell 里启动，内嵌终端会继承这套
//   环境，profile 就能正常加载——效果和 `npm run dev` 一样，只是这里跑的是生产构建(无 Vite
//   开销，等同便携版的代码)。
import { spawnSync } from 'node:child_process'

function run(command) {
  const r = spawnSync(command, { stdio: 'inherit', shell: true })
  if (r.error) {
    console.error('[run-app] 执行失败:', r.error.message)
    process.exit(1)
  }
  if (typeof r.status === 'number' && r.status !== 0) process.exit(r.status)
}

console.log('[run-app] 构建生产产物 (electron-vite build) …')
run('npx electron-vite build')
console.log('[run-app] 启动应用 (electron-vite preview，从当前终端继承环境) …')
run('npx electron-vite preview')
