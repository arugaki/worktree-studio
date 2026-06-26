import { spawnSync } from 'node:child_process'
import { existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import * as nodePty from '@homebridge/node-pty-prebuilt-multiarch'
import type { IPty } from '@homebridge/node-pty-prebuilt-multiarch'

let cachedShell: string | null = null

/** 解析 PowerShell 7(pwsh)的可执行路径,回退到 Windows 自带 powershell */
export function resolveDefaultShell(): string {
  if (cachedShell) return cachedShell
  // 1) 标准安装位置(纯 existsSync,最快,绝大多数机器命中,避免 spawnSync 冻结主进程)
  //    末项是 Store 版 PowerShell 的执行别名,很多 Win11 只装了商店版,命中它即可免去 where.exe
  const candidates = [
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe',
    join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'pwsh.exe')
  ]
  for (const c of candidates) {
    if (existsSync(c)) {
      cachedShell = c
      return cachedShell
    }
  }
  // 2) PATH 中的 pwsh(Store 应用别名也在此);带超时,避免 where.exe 卡住主进程
  try {
    const r = spawnSync('where.exe', ['pwsh.exe'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 1500
    })
    if (r.status === 0) {
      const first = r.stdout.split(/\r?\n/).find((l) => l.trim())
      if (first && existsSync(first.trim())) {
        cachedShell = first.trim()
        return cachedShell
      }
    }
  } catch {
    /* ignore */
  }
  // 3) 别名 / 系统 powershell 兜底
  cachedShell = process.env.SHELL || 'powershell.exe'
  return cachedShell
}

export interface PtyHandle {
  id: string
  pty: IPty
  workspaceId: string
}

type DataCb = (id: string, data: string) => void
type ExitCb = (id: string, exitCode: number) => void

export class PtyManager {
  private map = new Map<string, PtyHandle>()
  private onData: DataCb
  private onExit: ExitCb

  constructor(onData: DataCb, onExit: ExitCb) {
    this.onData = onData
    this.onExit = onExit
  }

  create(opts: {
    id: string
    workspaceId: string
    cwd: string
    shellPath?: string
    args?: string[]
    cols?: number
    rows?: number
  }): { id: string; shellPath: string } {
    const shell = opts.shellPath || resolveDefaultShell()
    // profile 自带参数(WSL / Git Bash 等)优先;否则按 shell 类型给默认参数
    const isCmd = /cmd\.exe$/i.test(shell)
    const args = opts.args ?? (isCmd ? [] : ['-NoLogo'])

    const spawnOptions = {
      name: 'xterm-256color',
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      cwd: existsSync(opts.cwd) ? opts.cwd : process.cwd(),
      env: {
        ...process.env,
        // 让 Claude Code / Codex 等 TUI 识别为真彩交互终端
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '1'
      },
      // multiarch 自带较新 ConPTY,获得更干净的 TUI 重绘
      useConpty: true
    }

    let proc: IPty
    try {
      const _t = Date.now()
      proc = nodePty.spawn(shell, args, spawnOptions as nodePty.IPtyForkOptions)
      if (process.env.WTS_PERF) console.log('[perf] node-pty spawn', Date.now() - _t, 'ms', shell)
    } catch (err) {
      console.error('[pty.create] spawn 失败', JSON.stringify({ shell, args }), err)
      throw err
    }

    const handle: PtyHandle = { id: opts.id, pty: proc, workspaceId: opts.workspaceId }
    this.map.set(opts.id, handle)

    const logPath = process.env.WTS_PTY_LOG
    const t0 = Date.now()
    proc.onData((data) => {
      // 调试用:设置 WTS_PTY_LOG=<文件> 时记录原始字节(转义序列以  形式可读)
      if (logPath) {
        try {
          appendFileSync(logPath, `${Date.now() - t0} ${JSON.stringify(data)}\n`)
        } catch {
          /* ignore */
        }
      }
      this.onData(opts.id, data)
    })
    proc.onExit(({ exitCode }) => {
      this.onExit(opts.id, exitCode)
      this.map.delete(opts.id)
    })

    return { id: opts.id, shellPath: shell }
  }

  write(id: string, data: string): void {
    this.map.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const h = this.map.get(id)
    if (!h) return
    try {
      h.pty.resize(Math.max(1, cols), Math.max(1, rows))
    } catch {
      /* 终端可能已退出 */
    }
  }

  kill(id: string): void {
    const h = this.map.get(id)
    if (!h) return
    const pid = h.pty.pid
    try {
      h.pty.kill()
    } catch {
      /* ignore */
    }
    // 强杀整棵进程树:pwsh 下可能挂着 codex 等子进程,ConPTY kill 不一定连带,
    // 否则残留子进程会卡住主进程不退出、并锁住便携 exe。
    if (pid) {
      try {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          timeout: 4000
        })
      } catch {
        /* ignore */
      }
    }
    this.map.delete(id)
  }

  /** 杀掉某工作区下的全部终端(删除工作区前调用,释放 worktree 目录占用) */
  killByWorkspace(workspaceId: string): void {
    for (const [id, h] of [...this.map.entries()]) {
      if (h.workspaceId === workspaceId) this.kill(id)
    }
  }

  killAll(): void {
    for (const id of [...this.map.keys()]) this.kill(id)
  }
}
