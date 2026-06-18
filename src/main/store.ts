import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Workspace } from '../shared/types'

interface PersistShape {
  workspaces: Workspace[]
}

function storePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'workspaces.json')
}

export function loadWorkspaces(): Workspace[] {
  try {
    const p = storePath()
    if (!existsSync(p)) return []
    const data = JSON.parse(readFileSync(p, 'utf8')) as PersistShape
    return Array.isArray(data.workspaces) ? data.workspaces : []
  } catch {
    return []
  }
}

export function saveWorkspaces(workspaces: Workspace[]): void {
  const p = storePath()
  const data: PersistShape = { workspaces }
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
}
