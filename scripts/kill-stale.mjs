// 启动开发/预览前,清理上一次遗留的本项目进程:
//   1) 本项目目录下的 electron.exe(上次没关干净的应用窗口/主进程)
//   2) 命令行里含 'vite' 且属于本项目的 node 进程(孤儿 dev server)
//
// 为什么这样过滤:
//   本脚本是 npm 在 `predev` / `preapp` 阶段拉起的,此刻本次 dev/preview 还没启动,
//   所以「命令行含 vite」的 node 进程必然是上一次的残留;而当前 npm 与本清理脚本的
//   命令行都不含 vite,绝不会误杀自己。再叠加「命令行含本项目路径」二次过滤,
//   避免动到你其他项目的 Electron / Vite。
//
// 仅在 Windows 执行(开发机为 Windows);其他平台直接跳过、不阻塞启动。
import { execSync } from 'node:child_process'

if (process.platform !== 'win32') process.exit(0)

const ownPid = process.pid
const cwd = process.cwd()

const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$proj = '${cwd.replace(/'/g, "''")}'
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -like ('*' + $proj + '*') } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object {
    $_.ProcessId -ne ${ownPid} -and
    $_.CommandLine -match 'vite' -and
    $_.CommandLine -like ('*' + $proj + '*')
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
`.trim()

try {
  // 用 -EncodedCommand(UTF-16LE base64)规避所有引号/路径转义问题
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64')
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, {
    stdio: 'ignore'
  })
  console.log('[kill-stale] 已清理本项目残留的 electron / vite 进程')
} catch {
  // 没有残留 / 清理失败都不应阻塞启动
}
