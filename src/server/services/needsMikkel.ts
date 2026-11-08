import { getDb } from '../db/database.ts'
import { tagsForItem } from '../repo/itemTags.ts'
import type {
  ItemType,
  NeedsMikkelGroup,
  NeedsMikkelInbox,
  NeedsMikkelItem,
  Priority,
  WriteSource
} from '../../shared/types.ts'

// The one place the tag name lives. Agents set it with `launchpad task tag <id> needs-mikkel`
// (or `tags: ["needs-mikkel"]` in a push plan); matching is case-insensitive like every tag.
export const NEEDS_MIKKEL_TAG = 'needs-mikkel'

const EXCERPT_LENGTH = 200

// "Open" per kind: a task that is not done and not archived; an idea still `open` (a promoted
// idea already became a task, which inherits its tags, so listing both would double it); a
// note that is not archived. Ideas archive through their status and have no done state.
const OPEN_ITEMS_SQL = `
  SELECT 'task' AS kind, x.id, x.project_id, x.title, x.body, x.status, x.priority,
         x.source, x.updated_by, x.created_at, x.updated_at
    FROM tasks x
   WHERE x.status != 'done' AND x.archived_at IS NULL
     AND EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id
                  WHERE it.item_type = 'task' AND it.item_id = x.id AND t.name = ? COLLATE NOCASE)
  UNION ALL
  SELECT 'idea', x.id, x.project_id, x.title, x.body, x.status, x.priority,
         x.source, x.updated_by, x.created_at, x.updated_at
    FROM ideas x
   WHERE x.status = 'open'
     AND EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id
                  WHERE it.item_type = 'idea' AND it.item_id = x.id AND t.name = ? COLLATE NOCASE)
  UNION ALL
  SELECT 'note', x.id, x.project_id, x.title, x.body, NULL, NULL,
         x.source, x.updated_by, x.created_at, x.updated_at
    FROM notes x
   WHERE x.archived_at IS NULL
     AND EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id
                  WHERE it.item_type = 'note' AND it.item_id = x.id AND t.name = ? COLLATE NOCASE)
`

interface Row {
  kind: ItemType
  id: number
  project_id: number
  title: string
  body: string | null
  status: string | null
  priority: string | null
  source: string
  updated_by: string
  created_at: string
  updated_at: string
  project_name: string
  project_path: string
}

function excerptOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat
}

// Cheap enough to poll: the tray asks for it every minute.
export function needsMikkelCount(tag: string = NEEDS_MIKKEL_TAG): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM (${OPEN_ITEMS_SQL}) i JOIN projects p ON p.id = i.project_id`
    )
    .get(tag, tag, tag) as { n: number }
  return Number(row.n)
}

export function listNeedsMikkel(tag: string = NEEDS_MIKKEL_TAG): NeedsMikkelInbox {
  const rows = getDb()
    .prepare(
      `SELECT i.*, p.name AS project_name, p.path AS project_path
         FROM (${OPEN_ITEMS_SQL}) i
         JOIN projects p ON p.id = i.project_id
        ORDER BY COALESCE(NULLIF(i.updated_at, ''), i.created_at) DESC, i.kind ASC, i.id DESC`
    )
    .all(tag, tag, tag) as unknown as Row[]

  // Rows arrive newest first, so the first row seen for a project is its newest item and
  // the groups end up ordered by their newest item simply by insertion order.
  const groups = new Map<number, NeedsMikkelGroup>()
  for (const row of rows) {
    let group = groups.get(row.project_id)
    if (!group) {
      group = {
        projectId: row.project_id,
        projectName: row.project_name,
        projectPath: row.project_path,
        latestAt: row.updated_at || row.created_at,
        items: []
      }
      groups.set(row.project_id, group)
    }
    const item: NeedsMikkelItem = {
      kind: row.kind,
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      excerpt: excerptOf(row.body ?? ''),
      status: (row.status ?? null) as NeedsMikkelItem['status'],
      priority: (row.priority ?? null) as Priority | null,
      tags: tagsForItem(row.kind, row.id),
      source: row.source as WriteSource,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
    group.items.push(item)
  }
  return { tag, total: rows.length, groups: [...groups.values()] }
}
