import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanRepos, getStatus } from './git'
import { createWorkspace, removeWorkspace } from './workspace'
import { PtyManager, resolveDefaultShell } from './pty'

/** 端到端验证 worktree 引擎:建临时多仓库 → 建工作区 → 校验分支/改动 → 删除 */
async function testWorktreeEngine(): Promise<boolean> {
  const root = join(tmpdir(), 'wts-smoke-' + Date.now().toString(36))
  const g = (cwd: string, args: string[]): void => {
    execFileSync('git', args, { cwd, stdio: 'pipe', windowsHide: true })
  }
  try {
    mkdirSync(root, { recursive: true })
    // 两个临时 git 仓库,各有一次初始提交
    for (const name of ['repoA', 'repoB']) {
      const dir = join(root, name)
      mkdirSync(dir, { recursive: true })
      g(dir, ['init', '-q'])
      writeFileSync(join(dir, 'readme.txt'), 'hello ' + name)
      g(dir, ['add', '.'])
      g(dir, [
        '-c',
        'user.email=smoke@test.local',
        '-c',
        'user.name=smoke',
        'commit',
        '-q',
        '-m',
        'init'
      ])
    }

    const scan = scanRepos(root)
    if (scan.repos.length !== 2) throw new Error(`扫描应得 2 仓库,实得 ${scan.repos.length}`)
    console.log('[smoke] scanRepos 发现 2 个临时仓库 ✓')

    const ws = await createWorkspace({
      name: 'smoke-feat',
      rootDir: root,
      repoNames: ['repoA', 'repoB']
    })
    console.log('[smoke] createWorkspace 完成,worktreeRoot =', ws.worktreeRoot)

    for (const repo of ['repoA', 'repoB']) {
      const wt = join(ws.worktreeRoot, repo)
      if (!existsSync(wt)) throw new Error(`worktree 未创建: ${wt}`)
      const st = await getStatus(repo, wt)
      if (st.branch !== 'smoke-feat')
        throw new Error(`${repo} 分支应为 smoke-feat,实为 ${st.branch}`)
    }
    console.log('[smoke] 两个仓库 worktree 均在分支 smoke-feat ✓')

    // 制造改动并验证被检测到
    writeFileSync(join(ws.worktreeRoot, 'repoA', 'new.txt'), 'change')
    const stA = await getStatus('repoA', join(ws.worktreeRoot, 'repoA'))
    if (stA.changes.length < 1) throw new Error('改动未被检测到')
    console.log('[smoke] git 改动检测正常,repoA 改动数 =', stA.changes.length, '✓')

    // 复现问题#3:在 worktree 内开一个 pwsh(占用目录),再走「杀终端→删除」流程
    const mgr = new PtyManager(
      () => {},
      () => {}
    )
    mgr.create({
      id: 'wt-lock',
      workspaceId: ws.id,
      cwd: join(ws.worktreeRoot, 'repoA'),
      cols: 80,
      rows: 24
    })
    await new Promise((r) => setTimeout(r, 900)) // 让 pwsh 以该目录为 cwd 稳定运行
    mgr.killByWorkspace(ws.id) // = 删除工作区前的步骤

    await removeWorkspace(ws.id, true)
    if (existsSync(ws.worktreeRoot))
      throw new Error('removeWorkspace 后 .wt/<name> 目录仍存在')
    console.log('[smoke] 占用情况下仍成功删除 .wt/<name> 目录 ✓')
    return true
  } catch (e) {
    console.error('[smoke] worktree 引擎测试失败:', e)
    return false
  } finally {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

/**
 * 无界面冒烟测试:验证最关键的原生能力——node-pty 在 Electron 运行时能拉起
 * 真实 pwsh、双向通信。同时轻量验证 git 模块不抛错。
 * 返回 0 表示通过,非 0 失败。
 */
export async function runSmoke(): Promise<number> {
  console.log('[smoke] ===== Worktree Studio 冒烟测试 =====')

  // 1) git 模块基本可用
  try {
    const scan = scanRepos(process.cwd())
    console.log(`[smoke] git.scanRepos OK,发现 ${scan.repos.length} 个仓库`)
    const st = await getStatus('nonexistent', 'Z:\\__no_such_path__')
    if (st.exists !== false) throw new Error('不存在路径应返回 exists=false')
    console.log('[smoke] git.getStatus(不存在路径) OK')
  } catch (e) {
    console.error('[smoke] git 模块失败:', e)
    return 1
  }

  // 2) worktree 引擎端到端
  const engineOk = await testWorktreeEngine()
  if (!engineOk) return 1

  // 3) node-pty 在 Electron 下拉起 pwsh 并双向通信
  const shell = resolveDefaultShell()
  console.log('[smoke] 解析到 shell =', shell)

  return new Promise<number>((resolve) => {
    let out = ''
    let done = false
    const finish = (code: number): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        mgr.killAll()
      } catch {
        /* ignore */
      }
      console.log('[smoke] 终端输出尾部:', JSON.stringify(out.slice(-160)))
      console.log(code === 0 ? '[smoke] ✅ 通过' : '[smoke] ❌ 失败', '(code', code + ')')
      resolve(code)
    }

    const mgr = new PtyManager(
      (_id, data) => {
        out += data
        if (out.includes('SMOKE_OK_MARKER')) finish(0)
      },
      (_id, _code) => {
        finish(out.includes('SMOKE_OK_MARKER') ? 0 : 1)
      }
    )

    const timer = setTimeout(() => {
      console.error('[smoke] 超时:未收到终端标记')
      finish(1)
    }, 20000)

    try {
      const r = mgr.create({
        id: 'smoke',
        workspaceId: 'smoke',
        cwd: process.cwd(),
        cols: 80,
        rows: 24
      })
      console.log('[smoke] pty 已创建,shell =', r.shellPath)
      setTimeout(() => {
        mgr.write('smoke', 'Write-Output "SMOKE_OK_MARKER"; exit\r\n')
      }, 1000)
    } catch (e) {
      console.error('[smoke] pty 创建失败:', e)
      finish(1)
    }
  })
}
