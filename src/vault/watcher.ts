import { watch, readdirSync, type FSWatcher } from "fs"
import { resolve, relative, join } from "path"
import { Glob } from "bun"
import { NOTE_TYPE_PRIORITY, type NoteEntry } from "./types"
import { parseNote } from "./parser"

function sortEntries(entries: NoteEntry[]): void {
  entries.sort(
    (a, b) =>
      NOTE_TYPE_PRIORITY[a.frontmatter.type] -
      NOTE_TYPE_PRIORITY[b.frontmatter.type],
  )
}

function removeEntry(entries: NoteEntry[], filePath: string): boolean {
  const idx = entries.findIndex((e) => e.filePath === filePath)
  if (idx === -1) return false
  entries.splice(idx, 1)
  return true
}

async function upsertEntry(
  entries: NoteEntry[],
  filePath: string,
  vaultPath: string,
): Promise<void> {
  removeEntry(entries, filePath)
  const entry = await parseNote(filePath, vaultPath)
  if (entry) {
    entries.push(entry)
    sortEntries(entries)
  }
}

export function watchVault(
  vaultPath: string,
  entries: NoteEntry[],
): () => void {
  const watchers = new Map<string, FSWatcher>()
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = async () => {
    const paths = [...pending]
    pending.clear()

    for (const rel of paths) {
      const abs = resolve(vaultPath, rel)
      const exists = await Bun.file(abs).exists()

      if (exists) {
        await upsertEntry(entries, abs, vaultPath)
        console.error(`[watcher] upserted ${rel}`)
      } else {
        const removed = removeEntry(entries, abs)
        if (removed) console.error(`[watcher] removed ${rel}`)
      }
    }
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, 300)
  }

  const removeDirWatcher = (dirPath: string) => {
    const w = watchers.get(dirPath)
    if (w) {
      w.close()
      watchers.delete(dirPath)
    }
  }

  const addDirWatcher = (dirPath: string) => {
    if (watchers.has(dirPath)) return

    try {
      const w = watch(dirPath, (event, filename) => {
        if (!filename) return

        const abs = join(dirPath, filename)
        const rel = relative(vaultPath, abs)

        if (rel.split("/").some((seg) => seg.startsWith("."))) return

        if (filename.endsWith(".md")) {
          pending.add(rel)
          schedule()
          return
        }

        if (event === "rename") {
          try {
            readdirSync(abs)
            addDirWatcher(abs)
            const glob = new Glob("**/*.md")
            for (const match of glob.scanSync({ cwd: abs })) {
              const mdRel = relative(vaultPath, join(abs, match))
              if (!mdRel.split("/").some((seg) => seg.startsWith("."))) {
                pending.add(mdRel)
              }
            }
            schedule()
          } catch {
            removeDirWatcher(abs)
          }
        }
      })
      watchers.set(dirPath, w)
    } catch (err) {
      console.error(`[watcher] failed to watch ${dirPath}: ${err}`)
    }
  }

  const walkAndWatch = (dirPath: string) => {
    addDirWatcher(dirPath)
    try {
      for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          walkAndWatch(join(dirPath, entry.name))
        }
      }
    } catch {}
  }

  walkAndWatch(vaultPath)

  return () => {
    if (timer) clearTimeout(timer)
    for (const w of watchers.values()) w.close()
    watchers.clear()
  }
}
