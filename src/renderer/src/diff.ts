// 行级 Myers O(ND) 差分 + 并排行构建。用于「变更前/变更后」并排 diff 视图。

export interface DiffRow {
  kind: 'eq' | 'del' | 'ins' | 'mod'
  left?: { n: number; text: string }
  right?: { n: number; text: string }
}

type Op = { t: 'eq' | 'del' | 'ins'; ai: number; bi: number }

/** Myers 差分,返回有序操作序列(eq=两边同行,del=仅左,ins=仅右) */
function myers(a: string[], b: string[]): Op[] {
  const n = a.length
  const m = b.length
  if (n === 0) return b.map((_, i) => ({ t: 'ins', ai: -1, bi: i }))
  if (m === 0) return a.map((_, i) => ({ t: 'del', ai: i, bi: -1 }))

  const max = n + m
  const offset = max
  // v[k] 用一维数组模拟(下标 k+offset);trace 保存每个 d 步的 v 快照用于回溯
  const v = new Array<number>(2 * max + 1).fill(0)
  const trace: number[][] = []
  let found = -1

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        x = v[k + 1 + offset] // 向下(插入)
      } else {
        x = v[k - 1 + offset] + 1 // 向右(删除)
      }
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[k + offset] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
    if (found >= 0) break
  }

  // 回溯,逆序收集操作
  const ops: Op[] = []
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const vPrev = trace[d]
    const k = x - y
    let prevK: number
    if (k === -d || (k !== d && vPrev[k - 1 + offset] < vPrev[k + 1 + offset])) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }
    const prevX = vPrev[prevK + offset]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push({ t: 'eq', ai: x - 1, bi: y - 1 })
      x--
      y--
    }
    if (x === prevX) {
      ops.push({ t: 'ins', ai: -1, bi: y - 1 })
    } else {
      ops.push({ t: 'del', ai: x - 1, bi: -1 })
    }
    x = prevX
    y = prevY
  }
  while (x > 0 && y > 0) {
    ops.push({ t: 'eq', ai: x - 1, bi: y - 1 })
    x--
    y--
  }
  ops.reverse()
  return ops
}

function splitLines(s: string): string[] {
  if (s === '') return []
  const t = s.replace(/\r\n?/g, '\n')
  const lines = t.split('\n')
  // 末尾换行不额外产生一行
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** 由前/后文本构建并排 diff 行;把连续的删/增聚成一块对齐(短的一侧留空白行) */
export function buildDiffRows(before: string, after: string): DiffRow[] {
  const a = splitLines(before)
  const b = splitLines(after)
  const ops = myers(a, b)

  const rows: DiffRow[] = []
  let dels: { n: number; text: string }[] = []
  let inss: { n: number; text: string }[] = []
  const flush = (): void => {
    const len = Math.max(dels.length, inss.length)
    for (let i = 0; i < len; i++) {
      const l = dels[i]
      const r = inss[i]
      rows.push({ kind: l && r ? 'mod' : l ? 'del' : 'ins', left: l, right: r })
    }
    dels = []
    inss = []
  }
  for (const op of ops) {
    if (op.t === 'eq') {
      flush()
      rows.push({
        kind: 'eq',
        left: { n: op.ai + 1, text: a[op.ai] },
        right: { n: op.bi + 1, text: b[op.bi] }
      })
    } else if (op.t === 'del') {
      dels.push({ n: op.ai + 1, text: a[op.ai] })
    } else {
      inss.push({ n: op.bi + 1, text: b[op.bi] })
    }
  }
  flush()
  return rows
}

/** 统计新增/删除行数 */
export function diffStats(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const r of rows) {
    if (r.kind === 'ins') added++
    else if (r.kind === 'del') removed++
    else if (r.kind === 'mod') {
      added++
      removed++
    }
  }
  return { added, removed }
}
