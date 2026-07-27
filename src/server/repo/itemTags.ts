import { getDb } from '../db/database.ts'
import { getOrCreateTag } from './tags.ts'
import type { ItemType, Tag } from '../../shared/types.ts'

export function tagsForItem(itemType: ItemType, itemId: number): Tag[] {
  return getDb()
    .prepare(
      `SELECT t.* FROM tags t
       JOIN item_tags it ON it.tag_id = t.id
       WHERE it.item_type = ? AND it.item_id = ? ORDER BY t.name ASC`
    )
    .all(itemType, itemId) as unknown as Tag[]
}

// One query for every item of a kind in a project — avoids N+1 when listing.
export function tagsForProjectItems(itemType: ItemType, projectId: number): Map<number, Tag[]> {
  const table = itemType === 'task' ? 'tasks' : itemType === 'idea' ? 'ideas' : 'notes'
  const rows = getDb()
    .prepare(
      `SELECT it.item_id AS iid, t.id, t.name, t.color FROM item_tags it
       JOIN tags t ON t.id = it.tag_id
       JOIN ${table} x ON x.id = it.item_id
       WHERE it.item_type = ? AND x.project_id = ?
       ORDER BY t.name ASC`
    )
    .all(itemType, projectId) as unknown as Array<{
    iid: number
    id: number
    name: string
    color: string
  }>
  const map = new Map<number, Tag[]>()
  for (const row of rows) {
    const list = map.get(row.iid) ?? []
    list.push({ id: row.id, name: row.name, color: row.color })
    map.set(row.iid, list)
  }
  return map
}

export function addTagToItem(itemType: ItemType, itemId: number, tagId: number): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO item_tags (item_type, item_id, tag_id) VALUES (?, ?, ?)')
    .run(itemType, itemId, tagId)
}

export function removeTagFromItem(itemType: ItemType, itemId: number, tagId: number): void {
  getDb()
    .prepare('DELETE FROM item_tags WHERE item_type = ? AND item_id = ? AND tag_id = ?')
    .run(itemType, itemId, tagId)
}

// Replace an item's whole tag set, creating any tag that doesn't exist yet.
// Returns true when the set actually changed.
export function setItemTags(itemType: ItemType, itemId: number, names: string[]): boolean {
  const wanted = new Map<number, string>()
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    const tag = getOrCreateTag(name)
    wanted.set(tag.id, tag.name)
  }
  const current = new Set(tagsForItem(itemType, itemId).map((t) => t.id))
  let changed = false
  for (const id of wanted.keys()) {
    if (!current.has(id)) {
      addTagToItem(itemType, itemId, id)
      changed = true
    }
  }
  for (const id of current) {
    if (!wanted.has(id)) {
      removeTagFromItem(itemType, itemId, id)
      changed = true
    }
  }
  return changed
}

// item_tags has no foreign key on the item (the link is polymorphic), so deleting an
// item must clear its rows explicitly or they leak onto a later item with the same id.
export function clearItemTags(itemType: ItemType, itemId: number): void {
  getDb()
    .prepare('DELETE FROM item_tags WHERE item_type = ? AND item_id = ?')
    .run(itemType, itemId)
}
