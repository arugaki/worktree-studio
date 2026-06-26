import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TerminalProfile } from '../shared/types'
import { resolveDefaultShell } from './pty'

/**
 * 异步执行一个命令并收集 stdout(带超时)。用 spawn 而非 spawnSync,避免阻塞主进程的
 * 消息泵导致窗口「未响应」(wsl --list 首次调用尤其慢)。失败/超时一律返回空结果。
 */
function runAsync(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<{ status: number; stdout: Buffer }> {
  return new Promise((resolve) => {
    let settled = false
    const done = (status: number, stdout: Buffer): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ status, stdout })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, { windowsHide: true })
    } catch {
      done(-1, Buffer.alloc(0))
      return
    }
    const chunks: Buffer[] = []
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      done(-1, Buffer.concat(chunks))
    }, timeoutMs)
    child.stdout?.on('data', (d: Buffer) => chunks.push(d))
    child.on('error', () => done(-1, Buffer.concat(chunks)))
    child.on('close', (code) => done(code ?? -1, Buffer.concat(chunks)))
  })
}

/**
 * 枚举本机可用的终端配置,模仿 Windows Terminal 下拉:
 *  1) 解析 Windows Terminal 的 settings.json(WSL / 自定义 profile / cmd 等都在此)
 *  2) 直接 `wsl --list` 兜底补齐发行版(WT 的 WSL 项常以无 commandline 的存根写入)
 *  3) 探测 Git Bash
 *  4) 内置 pwsh / Windows PowerShell / CMD 兜底,保证列表永不为空
 * 每个来源独立 try/catch,任一失败不影响其余;最终按"可执行+参数"去重。
 */
export async function listShellProfiles(): Promise<TerminalProfile[]> {
  const out: TerminalProfile[] = []
  const seen = new Set<string>()
  const seenLabels = new Set<string>()
  const add = (p: TerminalProfile): void => {
    const key = (p.shellPath + '|' + (p.args ?? []).join(' ')).toLowerCase()
    const label = p.label.trim().toLowerCase()
    // 同命令或同显示名都视作重复(内置兜底用全路径、WT 用裸 pwsh.exe,靠 label 去重)
    if (seen.has(key) || seenLabels.has(label)) return
    seen.add(key)
    seenLabels.add(label)
    out.push(p)
  }

  // 1) Windows Terminal 配置(最丰富,先加,优先保留它的命名)
  try {
    for (const p of readWindowsTerminalProfiles()) add(p)
  } catch {
    /* ignore */
  }

  // 2) WSL 发行版(WT 存根常缺 commandline,这里直接问 wsl 才完整)— 异步,不阻塞主进程
  try {
    for (const p of await enumWslDistros()) add(p)
  } catch {
    /* ignore */
  }

  // 3) Git Bash
  try {
    const gb = await findGitBash()
    if (gb) add({ id: 'git-bash', label: 'Git Bash', shellPath: gb, args: ['-i', '-l'], source: 'git' })
  } catch {
    /* ignore */
  }

  // 4) 内置兜底
  add({ id: 'pwsh', label: 'PowerShell 7', shellPath: resolveDefaultShell(), args: ['-NoLogo'], source: 'builtin' })
  add({ id: 'powershell', label: 'Windows PowerShell', shellPath: 'powershell.exe', args: ['-NoLogo'], source: 'builtin' })
  add({ id: 'cmd', label: 'CMD', shellPath: 'cmd.exe', args: [], source: 'builtin' })

  return out
}

// ---- Windows Terminal settings.json ----

/** 已知内置 profile 的 GUID → 默认命令(WT 这些项通常不写 commandline) */
const KNOWN_GUID_CMD: Record<string, { file: string; args: string[] }> = {
  '{61c54bbd-c2c6-5271-96e7-009a87ff44bf}': { file: 'powershell.exe', args: ['-NoLogo'] },
  '{0caa0dad-35be-5f56-a8ff-afceeeaa6101}': { file: 'cmd.exe', args: [] }
}

function wtSettingsCandidates(): string[] {
  const local = process.env.LOCALAPPDATA
  if (!local) return []
  return [
    join(local, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    join(local, 'Packages', 'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    join(local, 'Microsoft', 'Windows Terminal', 'settings.json')
  ]
}

function readWindowsTerminalProfiles(): TerminalProfile[] {
  const file = wtSettingsCandidates().find((f) => existsSync(f))
  if (!file) return []
  const raw = readFileSync(file, 'utf8')
  const json = JSON.parse(stripJsonc(raw)) as {
    profiles?: { list?: WtProfile[] } | WtProfile[]
  }
  const list = Array.isArray(json.profiles)
    ? json.profiles
    : (json.profiles?.list ?? [])

  const result: TerminalProfile[] = []
  for (const p of list) {
    if (!p || p.hidden) continue
    let file2 = ''
    let args: string[] = []
    if (p.commandline && p.commandline.trim()) {
      const parts = splitCommandLine(p.commandline)
      file2 = parts[0]
      args = parts.slice(1)
    } else if (p.guid && KNOWN_GUID_CMD[p.guid.toLowerCase()]) {
      const k = KNOWN_GUID_CMD[p.guid.toLowerCase()]
      file2 = k.file
      args = k.args
    } else {
      // 无 commandline 且非已知项(如 WSL 存根 / Azure Cloud Shell):无法可靠启动,跳过
      continue
    }
    result.push({
      id: p.guid ?? 'wt-' + result.length,
      label: p.name ?? file2,
      shellPath: file2,
      args,
      source: 'wt'
    })
  }
  return result
}

interface WtProfile {
  guid?: string
  name?: string
  commandline?: string
  source?: string
  hidden?: boolean
}

/** 去掉 JSONC 的 // 与 /* *​/ 注释和尾逗号,但不动字符串内部 */
function stripJsonc(s: string): string {
  let out = ''
  let inStr = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const n = s[i + 1]
    if (inLine) {
      if (c === '\n') {
        inLine = false
        out += c
      }
      continue
    }
    if (inBlock) {
      if (c === '*' && n === '/') {
        inBlock = false
        i++
      }
      continue
    }
    if (inStr) {
      out += c
      if (c === '\\') {
        out += n ?? ''
        i++
      } else if (c === '"') {
        inStr = false
      }
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      continue
    }
    if (c === '/' && n === '/') {
      inLine = true
      i++
      continue
    }
    if (c === '/' && n === '*') {
      inBlock = true
      i++
      continue
    }
    out += c
  }
  // 去尾逗号: ,} 或 ,]
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/** 把 Windows 命令行字符串切成 [file, ...args],尊重双引号 */
function splitCommandLine(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  let has = false
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (c === '"') {
      q = !q
      has = true
    } else if (!q && /\s/.test(c)) {
      if (has) {
        out.push(cur)
        cur = ''
        has = false
      }
    } else {
      cur += c
      has = true
    }
  }
  if (has) out.push(cur)
  return out
}

// ---- WSL ----

async function enumWslDistros(): Promise<TerminalProfile[]> {
  const r = await runAsync('wsl.exe', ['--list', '--quiet'], 2500)
  if (r.status !== 0 || r.stdout.length === 0) return []
  // 输出是 UTF-16LE,逐行一个发行版名
  const text = r.stdout.toString('utf16le')
  const distros = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\0/g, '').trim())
    .filter(Boolean)
    // docker-desktop* 不是可交互 shell,WT 默认也不展示
    .filter((d) => !/^docker-desktop/i.test(d))
  return distros.map((d) => ({
    id: 'wsl-' + d.toLowerCase(),
    label: d,
    shellPath: 'wsl.exe',
    args: ['-d', d],
    source: 'wt' as const
  }))
}

// ---- Git Bash ----

async function findGitBash(): Promise<string | null> {
  const candidates = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe')
  ]
  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  // PATH 里找 git,再推导出 bash(异步 where.exe,带超时)
  try {
    const r = await runAsync('where.exe', ['git.exe'], 1500)
    if (r.status === 0) {
      const gitExe = r.stdout
        .toString('utf8')
        .split(/\r?\n/)
        .find((l) => l.trim())
        ?.trim()
      if (gitExe) {
        // ...\Git\cmd\git.exe → ...\Git\bin\bash.exe
        const bash = join(gitExe, '..', '..', 'bin', 'bash.exe')
        if (existsSync(bash)) return bash
      }
    }
  } catch {
    /* ignore */
  }
  return null
}
