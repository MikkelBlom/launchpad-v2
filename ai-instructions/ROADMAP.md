# Roadmap — Launchpad v2

A batch of features/improvements built in the "full-on" autonomous session (2026-07-07).
Everything here uses only already-installed dependencies (no new downloads).

Legend: ✅ done · 🔨 in progress · 📋 planned

## Dashboard & navigation
1. ✅ Sort options (name / last commit / created / activity / open tasks)
2. ✅ Group by status toggle
3. ✅ "Needs attention" section (dirty repos, stalled active projects)
4. ✅ Stats header (totals by activity/status, uncommitted count)
5. ✅ Command palette (Ctrl/Cmd-K) — jump to project or run an action
6. ✅ Global keyboard shortcuts (/, N, K, G-D/G-I/G-S)
7. ✅ Recent / activity view — what you touched, newest first
8. ✅ Auto-refresh project data on window focus
9. ✅ Live-updating relative times

## Projects
10. ✅ Tags (colored) — add/remove per project, filter the dashboard by tag
11. ✅ Archive / unarchive (hidden from default dashboard)
12. ✅ Inline rename
13. ✅ Delete confirmation (with a typed guard for safety)
14. ✅ Duplicate/nesting detection + merge helper (fixes scan/import overlap)
15. ✅ Bulk select → archive / delete / tag
16. ✅ Git history tab (recent commits via simple-git)
17. ✅ README preview (tiny dependency-free markdown renderer)
18. ✅ "Open terminal here" launch kind
19. ✅ Export a project snapshot to ai-instructions/LAUNCHPAD.md from the UI

## Tasks / ideas / notes
20. ✅ Task due dates + overdue highlighting
21. ✅ Task board (kanban columns) view toggle
22. ✅ Reorder tasks (up/down, no drag dependency)
23. ✅ Sort/filter tasks by priority & status
24. ✅ Convert idea → note and task → note
25. ✅ Note pinning + search within a project
26. ✅ Priority/status filters on ideas

## Capture & inbox
27. ✅ Smart capture parsing (#project, !high/!low, kind via verb) + kind selector
28. ✅ Inbox bulk actions (file all / clear)

## Search
29. ✅ Global search endpoint + palette results across projects/notes/ideas/tasks

## Settings & data
30. ✅ JSON backup + restore of the whole database
31. ✅ Open data folder; show data path; configurable scan depth & exclude dirs
32. ✅ Default dashboard sort/group preferences

## CLI
33. ✅ `launchpad list`, `launchpad open`, `launchpad note "…"` (push a note back), richer `status`

## Mobile / polish
34. ✅ Responsive layout (usable on a phone)
35. ✅ PWA manifest (add-to-home-screen) + app favicon

## Deferred (noted, not built this session)
- Optional local-AI (Ollama) assist — summaries, "what's next"
- ✅ Packaged installer (electron-builder) — done 2026-07-30, `npm run dist`. **Bundled Node is
  still open**, so the install needs system Node 24+ on PATH.
- Real mobile companion over LAN with auth
- Drag-and-drop reordering (needs a dnd dependency)
