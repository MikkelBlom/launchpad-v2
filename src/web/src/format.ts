import type { GitActivity, ProjectStatus } from '../../shared/types'

export function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '—'
  const diff = Date.now() - then
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(months / 12)}y ago`
}

export const ACTIVITY_META: Record<GitActivity, { label: string; dot: string; text: string }> = {
  fresh: { label: 'Fresh', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  recent: { label: 'Recent', dot: 'bg-lime-500', text: 'text-lime-700' },
  stalled: { label: 'Stalled', dot: 'bg-amber-500', text: 'text-amber-700' },
  dormant: { label: 'Dormant', dot: 'bg-stone-400', text: 'text-stone-500' },
  unknown: { label: 'No git', dot: 'bg-stone-300', text: 'text-stone-400' }
}

export const STATUS_META: Record<ProjectStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-brand-soft text-brand-strong' },
  idea: { label: 'Idea', cls: 'bg-violet-100 text-violet-700' },
  'on-hold': { label: 'On hold', cls: 'bg-amber-100 text-amber-700' },
  done: { label: 'Done', cls: 'bg-sky-100 text-sky-700' },
  archived: { label: 'Archived', cls: 'bg-stone-100 text-stone-500' }
}

export const PRIORITY_CLS: Record<string, string> = {
  high: 'bg-rose-100 text-rose-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-stone-100 text-stone-600'
}

export const STACK_EMOJI: Record<string, string> = {
  node: '🟢',
  python: '🐍',
  rust: '🦀',
  go: '🐹',
  dotnet: '🔷',
  java: '☕',
  ruby: '💎',
  php: '🐘',
  docker: '🐳',
  web: '🌐'
}
