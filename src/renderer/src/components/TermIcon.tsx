import type { TerminalMeta } from '@shared/types'

export type TermKind =
  | 'pwsh'
  | 'powershell'
  | 'cmd'
  | 'ubuntu'
  | 'debian'
  | 'gitbash'
  | 'wsl'
  | 'generic'

/** 按 shellPath / profile 名 / 启动参数推断终端类型,用于挑选图标 */
export function termKind(meta: TerminalMeta): TermKind {
  const p = (meta.shellPath || '').toLowerCase()
  const blob = ((meta.profileLabel || '') + ' ' + (meta.args || []).join(' ')).toLowerCase()
  if (p.includes('bash')) return 'gitbash'
  if (p.includes('wsl')) {
    if (blob.includes('ubuntu')) return 'ubuntu'
    if (blob.includes('debian')) return 'debian'
    return 'wsl'
  }
  if (p.includes('pwsh')) return 'pwsh'
  if (p.includes('powershell')) return 'powershell'
  if (p.includes('cmd')) return 'cmd'
  return 'generic'
}

const COLORS: Record<TermKind, string> = {
  pwsh: '#2671BE',
  powershell: '#012456',
  cmd: '#4d4d4d',
  ubuntu: '#E95420',
  debian: '#A81D33',
  gitbash: '#F1502F',
  wsl: '#4E9A06',
  generic: '#6b7280'
}

export function TermIcon({ meta, size = 14 }: { meta: TerminalMeta; size?: number }): JSX.Element {
  const kind = termKind(meta)

  // Ubuntu 用标志性的「朋友圈」橙色 logo
  if (kind === 'ubuntu') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className="term-tab-icon">
        <circle cx="12" cy="12" r="11" fill="#E95420" />
        <circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" strokeWidth="1.7" />
        <circle cx="12" cy="3.8" r="2" fill="#fff" />
        <circle cx="5" cy="16" r="2" fill="#fff" />
        <circle cx="19" cy="16" r="2" fill="#fff" />
      </svg>
    )
  }

  // 其余:按类型上色的圆角方块 + 终端提示符 ">_",颜色区分类型
  const c = COLORS[kind]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="term-tab-icon">
      <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill={c} />
      <path
        d="M6 8l4 4-4 4"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="12" y1="16.5" x2="18" y2="16.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
