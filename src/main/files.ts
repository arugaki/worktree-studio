import { readdir, readFile as fsReadFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { FileEntry, FileReadResult } from '../shared/types'

/** 文本读取上限:超过则不读,避免把大文件塞进渲染进程 */
const MAX_BYTES = 1.5 * 1024 * 1024

/** 列出目录条目:目录在前、再按名称排序(忽略大小写) */
export async function listDir(dir: string): Promise<FileEntry[]> {
  const ents = await readdir(dir, { withFileTypes: true })
  const out: FileEntry[] = ents.map((e) => ({
    name: e.name,
    path: join(dir, e.name),
    // 符号链接当作文件处理即可,展开失败也不致命
    isDir: e.isDirectory()
  }))
  out.sort((a, b) =>
    a.isDir === b.isDir
      ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      : a.isDir
        ? -1
        : 1
  )
  return out
}

/** 读取文件内容:目录/二进制/过大都用标志位返回,不抛 */
export async function readFileContent(path: string): Promise<FileReadResult> {
  const st = await stat(path)
  if (st.isDirectory()) {
    return { path, content: '', size: st.size, binary: false, tooLarge: false, isDir: true }
  }
  if (st.size > MAX_BYTES) {
    return { path, content: '', size: st.size, binary: false, tooLarge: true }
  }
  const buf = await fsReadFile(path)
  // 二进制探测:前 8KB 出现 NUL 字节即判为二进制
  const sample = buf.subarray(0, 8192)
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      return { path, content: '', size: st.size, binary: true, tooLarge: false }
    }
  }
  return { path, content: buf.toString('utf8'), size: st.size, binary: false, tooLarge: false }
}
