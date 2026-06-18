// 修掉 node-pty 在 Windows ConPTY 下关闭终端时的崩溃。
// node-pty 在 kill() 时会 fork conpty_console_list_agent.js 去列举 ConPTY 子进程,
// 当目标进程已退出 / 无控制台可附加时,getConsoleProcessList 抛 "AttachConsole failed",
// 该 fork 进程未捕获异常直接崩溃 → stderr 刷屏,应用退出码变 1。
// 我们本就用 taskkill /T /F 兜底杀进程树,这里把那次列举包成 try/catch:
// 失败就退回 [shellPid],既不影响杀进程,退出也干净。幂等,可重复执行。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const agent = join(
  root,
  'node_modules',
  '@homebridge',
  'node-pty-prebuilt-multiarch',
  'lib',
  'conpty_console_list_agent.js'
)

if (!existsSync(agent)) {
  console.log('[patch-node-pty] 未找到 agent 文件,跳过')
  process.exit(0)
}

let src = readFileSync(agent, 'utf8')

if (src.includes('wts-patch')) {
  console.log('[patch-node-pty] 已打过补丁,跳过')
  process.exit(0)
}

const target = 'var consoleProcessList = getConsoleProcessList(shellPid);'
const patched =
  'var consoleProcessList; try { consoleProcessList = getConsoleProcessList(shellPid); }' +
  ' catch (e) { consoleProcessList = [shellPid]; } /* wts-patch: AttachConsole failed 时不崩 */'

if (!src.includes(target)) {
  console.warn('[patch-node-pty] ⚠ 未匹配到目标行,node-pty 版本可能变了,未修改')
  process.exit(0)
}

src = src.replace(target, patched)
writeFileSync(agent, src)
console.log('[patch-node-pty] ✅ 已修补 conpty_console_list_agent.js')
