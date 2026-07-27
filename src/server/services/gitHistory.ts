import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import type { GitCommit } from '../../shared/types.ts'

export async function recentCommits(projectPath: string, limit = 20): Promise<GitCommit[]> {
  if (!existsSync(join(projectPath, '.git'))) return []
  try {
    const git = simpleGit(projectPath)
    const log = await git.log({ maxCount: limit })
    return log.all.map((c) => {
      const parsed = new Date(c.date)
      return {
        hash: c.hash.slice(0, 8),
        date: Number.isFinite(parsed.getTime()) ? parsed.toISOString() : c.date,
        message: c.message,
        author: c.author_name
      }
    })
  } catch {
    return []
  }
}
