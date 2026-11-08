#!/usr/bin/env node
// Launchpad CLI — the read/write surface AI agents (and Mikkel) use to talk to the local
// Launchpad service.
//
// Zero dependencies (Node 18+ global fetch). Install once with `npm link` from the
// launchpad-v2 folder, then run `launchpad guide` from anywhere.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, parse as parsePath, resolve as resolvePath } from 'node:path'
import { argv, cwd, env, exit, platform, stdout } from 'node:process'

const BASE = (env.LAUNCHPAD_URL || 'http://localhost:7420').replace(/\/$/, '')

// The API this CLI is written against. v5 moved /api/ports from one row per project to one
// row per claim, so an older service answers every ports command with a shape whose fields
// simply aren't there — and the CLI's first `.map` over one of them throws a TypeError that
// says nothing about the actual problem: a service running a build older than this file.
// `apiVersion` exists precisely so that mismatch can be named instead of crashed on.
//
// Bump this whenever the CLI starts depending on a new server shape, in step with the
// apiVersion in routes/system.ts.
const REQUIRES_API = 6
const BINDING_FILE = join('ai-instructions', '.launchpad.json')
const SNAPSHOT_FILE = join('ai-instructions', '.launchpad-snapshot.json')

// ---------------------------------------------------------------- args

function parseArgs(args) {
  const positional = []
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const [key, inline] = a.slice(2).split(/=(.*)/s)
      if (inline !== undefined) {
        flags[key] = inline
        continue
      }
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(a)
    }
  }
  return { positional, flags }
}

const list = (value) =>
  value === undefined || value === true
    ? undefined
    : String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

// `--label web` → "web"; a bare `--label` (parsed as true) counts as not given.
const flagText = (name) =>
  FLAGS[name] !== undefined && FLAGS[name] !== true ? String(FLAGS[name]) : undefined

const bool = (value, fallback = undefined) => {
  if (value === undefined) return fallback
  if (value === true) return true
  const s = String(value).toLowerCase()
  if (['true', 'yes', '1', 'on'].includes(s)) return true
  if (['false', 'no', '0', 'off'].includes(s)) return false
  return fallback
}

class CliError extends Error {}

// ---------------------------------------------------------------- api

let FLAGS = {}

// Interactive terminal => a human is typing; piped/redirected => an agent is driving.
// Either can be overridden with --source / --by.
function provenanceHeaders() {
  const actor = FLAGS.by !== undefined && FLAGS.by !== true ? String(FLAGS.by) : env.LAUNCHPAD_ACTOR || ''
  const inferred = stdout.isTTY && !actor ? 'cli' : 'agent'
  const source =
    FLAGS.source !== undefined && FLAGS.source !== true ? String(FLAGS.source) : inferred
  return { 'X-Launchpad-Source': source, 'X-Launchpad-Actor': actor }
}

async function api(path, init = {}) {
  // No keep-alive. A CLI run makes two or three requests and exits, so a pooled connection
  // buys nothing — and on Windows, exiting with one still open makes libuv abort
  // ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)") *after* the error has been
  // printed, replacing exit code 1 with a crash. An agent reading the exit code sees noise.
  const headers = { connection: 'close', ...provenanceHeaders(), ...(init.headers || {}) }
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(init.json)
  }
  let res
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers })
  } catch {
    throw new CliError(
      `Cannot reach Launchpad at ${BASE}. Is the Launchpad app/service running?\n` +
        `  Start it with: npm run dev  (in launchpad-v2)  ·  override the URL with LAUNCHPAD_URL`
    )
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).error || ''
    } catch {
      /* body wasn't json */
    }
    const err = new CliError(`Launchpad API ${res.status}${detail ? `: ${detail}` : ''}`)
    err.status = res.status
    throw err
  }
  return res
}

const getJson = async (path) => (await api(path)).json()
const post = async (path, json) => (await api(path, { method: 'POST', json })).json()

// A refused port claim is an ordinary answer, not a transport failure: the server's sentence
// already says which project holds the port and what to do about it, so it is shown on its
// own rather than wrapped in "Launchpad API 409:".
async function claimOrExplain(path, json) {
  try {
    return await post(path, json)
  } catch (error) {
    if (error.status === 409 || error.status === 400) {
      throw new CliError(String(error.message).replace(/^Launchpad API \d+: /, ''))
    }
    throw error
  }
}

const patch = async (path, json) => (await api(path, { method: 'PATCH', json })).json()
const put = async (path, json) => (await api(path, { method: 'PUT', json })).json()
const del = async (path) => (await api(path, { method: 'DELETE' })).json()

// ---------------------------------------------------------------- binding

// Walk up from the working directory so the CLI works from any subfolder of a project.
function findBinding(from = cwd()) {
  let dir = from
  const { root } = parsePath(dir)
  for (;;) {
    const file = join(dir, BINDING_FILE)
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf-8'))
        if (data && Number.isFinite(Number(data.projectId))) {
          return {
            file,
            dir,
            projectId: Number(data.projectId),
            name: data.name,
            // The folder the binding was written for. Absent in bindings written before this
            // field existed, which is why every use of it is conditional.
            path: typeof data.path === 'string' ? data.path : null
          }
        }
      } catch {
        /* unreadable binding is the same as no binding */
      }
    }
    if (dir === root) return null
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

// Windows paths differ in case without differing in meaning, so compare accordingly.
function samePath(a, b) {
  if (!a || !b) return false
  const norm = (p) => (platform === 'win32' ? resolvePath(p).toLowerCase() : resolvePath(p))
  return norm(a) === norm(b)
}

function writeBinding(project, dir = cwd()) {
  const file = join(dir, BINDING_FILE)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(
    file,
    `${JSON.stringify(
      { projectId: project.id, name: project.name, path: project.path, url: BASE },
      null,
      2
    )}\n`,
    'utf-8'
  )
  return file
}

// Notices about targeting go to stderr, never stdout: `--json` output is parsed by agents and a
// stray line would break it.
const warn = (message) => console.error(`! ${message}`)

// Both of these answer "or nothing" rather than throwing, so resolveProject can ask about a folder
// and an id at the same time and decide with both answers in hand.
const orNull404 = async (path) => {
  try {
    return await getJson(path)
  } catch (e) {
    if (e.status === 404) return null
    throw e
  }
}

// One /api/health before the command runs. A stale service is the difference between a
// sentence you can act on and a stack trace, and the request costs a few milliseconds
// against localhost.
function tooOldMessage(version) {
  return (
    `This Launchpad speaks API v${version || '?'}; this CLI needs v${REQUIRES_API}.\n` +
    `  The service is running a build older than the CLI — rebuild it and restart:\n` +
    `    npm run build            (in launchpad-v2)\n` +
    `    then the tray icon → Restart server   (or: npm run desktop)\n` +
    `  Rebuilding alone is not enough: the running process keeps the old bundle in memory.`
  )
}

async function assertApiVersion() {
  const version = Number((await getJson('/api/health'))?.apiVersion) || 0
  if (version < REQUIRES_API) throw new CliError(tooOldMessage(version))
}

const resolveByPath = (dir) => orNull404(`/api/projects/resolve?path=${encodeURIComponent(dir)}`)
const getProjectOrNull = (id) => orNull404(`/api/projects/${id}`)

async function findByNameOrId(needle) {
  const projects = await getJson('/api/projects')
  const n = String(needle).toLowerCase()
  return (
    projects.find((p) => String(p.id) === n) ||
    projects.find((p) => p.name.toLowerCase() === n) ||
    projects.find((p) => p.name.toLowerCase().includes(n)) ||
    null
  )
}

/**
 * Resolution order, most explicit first. It never guesses: if nothing matches, it fails
 * with instructions rather than picking a project an agent might not have meant.
 */
async function resolveProject(flags) {
  const explicit = flags.project ?? env.LAUNCHPAD_PROJECT
  if (explicit !== undefined && explicit !== true) {
    const match = await findByNameOrId(explicit)
    if (!match) throw new CliError(`No project matching "${explicit}". Try: launchpad list`)
    return match
  }

  const binding = findBinding()
  if (binding) {
    // The binding's id is a cache, not the identity. Database ids move — a duplicate merge keeps
    // one registration and frees the other's id for reuse — so trusting the id alone could target
    // whatever project inherited it. That is the one thing this CLI must never do: silently write
    // an agent's notes into somebody else's project.
    //
    // The folder is the identity. Ask which project is registered at the binding's folder, and let
    // that answer win.
    const [atFolder, atId] = await Promise.all([
      resolveByPath(binding.dir),
      getProjectOrNull(binding.projectId)
    ])

    if (atFolder) {
      if (!atId || atId.id !== atFolder.id) {
        // Stale id. Correct the file so the next command (and any other tool reading it) agrees,
        // and say so on stderr — stdout may be JSON an agent is parsing.
        try {
          writeBinding(atFolder, binding.dir)
          warn(
            `${binding.file} pointed at project #${binding.projectId}; this folder is ` +
              `#${atFolder.id} "${atFolder.name}". Binding updated.`
          )
        } catch {
          warn(
            `${binding.file} points at project #${binding.projectId}, but this folder is ` +
              `#${atFolder.id} "${atFolder.name}". Using #${atFolder.id}; the file could not be ` +
              `rewritten.`
          )
        }
      }
      return atFolder
    }

    // No project registered at this folder, so the binding is the only signal. Two ways it can
    // still be wrong, and both mean "refuse" rather than "guess":
    if (atId) {
      if (binding.path && !samePath(binding.path, binding.dir)) {
        throw new CliError(
          `${binding.file} was written for ${binding.path}, not this folder.\n` +
            `  It looks copied from another project, so #${binding.projectId} ` +
            `"${atId.name}" is probably not what you meant.\n` +
            `  → Re-bind with:  launchpad bind "<name or id>"`
        )
      }
      if (binding.name && binding.name !== atId.name) {
        throw new CliError(
          `${binding.file} names project "${binding.name}", but #${binding.projectId} is now ` +
            `"${atId.name}" — that id was reused.\n` +
            `  → Re-bind with:  launchpad bind "<name or id>"`
        )
      }
      return atId
    }

    throw new CliError(
      `${binding.file} points at project #${binding.projectId}, which no longer exists.\n` +
        `  → Re-bind with:  launchpad bind "<name or id>"`
    )
  }

  try {
    return await getJson(`/api/projects/resolve?path=${encodeURIComponent(cwd())}`)
  } catch (e) {
    if (e.status === 404) {
      throw new CliError(
        `This folder isn't bound to a Launchpad project.\n` +
          `  → Bind it:        launchpad bind "<name or id>"   (writes ${BINDING_FILE})\n` +
          `  → Or target one:  launchpad <command> --project "<name or id>"\n` +
          `  → See them all:   launchpad list`
      )
    }
    throw e
  }
}

// ---------------------------------------------------------------- output

const out = (line = '') => console.log(line)

function emit(data, humanFn) {
  if (FLAGS.json) {
    out(JSON.stringify(data, null, 2))
    return
  }
  humanFn()
}

const tagStr = (tags) => (tags?.length ? `  [${tags.map((t) => t.name).join(', ')}]` : '')

function printTask(t) {
  const mark = t.status === 'done' ? 'x' : t.status === 'doing' ? '~' : ' '
  const due = t.dueDate ? `  due ${t.dueDate.slice(0, 10)}` : ''
  const arch = t.archivedAt ? '  (archived)' : ''
  out(`  [${mark}] #${String(t.id).padEnd(4)} (${t.priority.padEnd(6)}) ${t.title}${due}${tagStr(t.tags)}${arch}`)
  if (t.body) for (const line of t.body.split('\n')) out(`             ${line}`)
}

function printIdea(i) {
  out(`  #${String(i.id).padEnd(4)} (${i.priority.padEnd(6)}) [${i.status}] ${i.title}${tagStr(i.tags)}`)
  if (i.body) for (const line of i.body.split('\n')) out(`         ${line}`)
}

function printNote(n) {
  out(`  #${String(n.id).padEnd(4)} ${n.pinned ? '📌 ' : ''}${n.title || '(untitled)'}${tagStr(n.tags)}${n.archivedAt ? '  (archived)' : ''}`)
  if (n.body) for (const line of n.body.split('\n')) out(`         ${line}`)
}

// ---------------------------------------------------------------- commands: orientation

const GUIDE = `Launchpad — agent guide
=======================

Launchpad is Mikkel's project command center: a local service (default http://localhost:7420)
whose SQLite database is the SINGLE SOURCE OF TRUTH for every project's description, tags,
tasks, ideas and notes. It also auto-derives each project's status from git.

You talk to it with this CLI. Markdown files in a repo are never read back — writing to
ai-instructions/LAUNCHPAD.md does nothing. Use the commands below.

RULES
  · Archive, never delete. Every destructive-looking command archives (reversible).
  · Push is merge-only and idempotent: it creates or updates, never removes. Re-running the
    same plan is safe — items are matched on their title.
  · Always --dry-run a push first, then apply.
  · Every command targets the project bound to the current folder. Use --project to override.
  · Add --json to any read command for machine-readable output.
  · Never invent a dev-server port. Ask for a free one (launchpad ports free), claim it
    (launchpad ports add <n>), then configure the dev server to use exactly that port.
    Claiming refuses a port another project holds — that refusal is the feature, not a
    hurdle to route around. Ask for another port instead.

TARGETING (most explicit wins)
  --project <id|name>  →  $LAUNCHPAD_PROJECT  →  ai-instructions/.launchpad.json  →  cwd path
  If nothing resolves the command fails; it never guesses.
  Within a binding, the FOLDER wins over the id written in it: project ids move (a duplicate
  merge frees an id for reuse), so a stale id is corrected from the folder rather than trusted.

ORIENTATION
  launchpad guide                      This text
  launchpad ping                       Is the service reachable
  launchpad whoami                     Which project this folder resolves to
  launchpad list [--json]              Every registered project
  launchpad bind <id|name>             Bind this folder (writes ai-instructions/.launchpad.json)
  launchpad unbind
  launchpad onboard [--project p]      Bind + write the Launchpad block into
                                       ai-instructions/CLAUDE.md + pull. Run once per project.

READING
  launchpad pull [--json] [--print]    This project's data. Plain: writes
                                       ai-instructions/LAUNCHPAD.md. --json: stdout only.
  launchpad status [--json]            Status, git state, counts
  launchpad audit [--all] [--json]     What's missing (no description/tags/tasks, untagged
                                       items, stalled). --all = every project.
  launchpad search "<q>" [--json]      Across all projects
  launchpad log [--limit n] [--source agent|cli|ui]   Recent writes
  launchpad timeline [--week 2026-W45|this|last|<date>] [--mine] [--json]
                                       What was committed that ISO week (Mon–Sun, local
                                       time) across every project, per day. --mine keeps
                                       only commits by each repo's git user.email.
  launchpad tasks|ideas|notes [--all] [--json]        List items (--all includes archived)
  launchpad task|idea|note get <id>

PROJECT
  launchpad set description "<text>"
  launchpad set status <active|idea|on-hold|done|archived>
  launchpad rename "<name>"
  launchpad scan                       Re-read git/stack/README for this project
  launchpad tag add <name> [--color "#78716c"]
  launchpad tag rm <name>
  launchpad tags                       Every tag in Launchpad
  launchpad register <path> [--name "<name>"]         Add an existing folder as a project

PORTS — which localhost each project runs on
  A project claims ONE PORT PER PROCESS it runs: a web server and an API are two claims on
  one project, not two projects.

  launchpad ports [--json]             Every claim, whether something is listening on it,
                                       conflicts, and ports in use that no project claims.
                                       Ends with free ports you may take.
  launchpad ports check <port> [--json]   Is it free, and who claims it
  launchpad ports free [--count 3] [--json]   Free ports Launchpad suggests. Excludes ports
                                       that are listening AND ports already claimed here.
  launchpad ports add <port> [--label "api"] [--force]
                                       Claim one more port, keeping the project's others
  launchpad ports rm <port>            Release one
  launchpad ports label <port> "<text>"   Say what runs on it
  launchpad ports primary <port>       Which one "open localhost" means
  launchpad set port <number>          Claim that port and RELEASE every other claim
  launchpad set port none              Release them all
  launchpad ports detect               Read this project's own config and claim every port it
                                       declares (.claude/launch.json, vite.config, package.json
                                       scripts, next.config, .env, docker-compose,
                                       launchSettings.json — the first file that names a port
                                       wins, and all of that file's ports are claimed)

  PICKING A PORT — do it in this order, never guess:
    launchpad ports free               1. see what is actually free right now
    launchpad ports add 7431           2. claim it in Launchpad before you use it
                                       3. configure the project's dev server (vite.config,
                                          .claude/launch.json, the npm script) to that port
  A claim is REFUSED if another project already holds the port — 409, naming that project;
  pick another, or pass --force if the two genuinely never run at the same time. 7420/7421 are
  Launchpad's own service and dev server: those are refused outright, --force or not.
  Ports another project runs on (PMS holds 3000/3001/5000, for instance) are refused by the
  same conflict rule as everything else, so "ports free" and "ports check" always know.

TASKS
  launchpad task add "<title>" [--body "…"] [--priority high|medium|low]
                                       [--due YYYY-MM-DD] [--status todo|doing|done] [--tags a,b]
  launchpad task update <id> [--title …] [--body …] [--priority …] [--status …] [--due …] [--tags a,b]
  launchpad task done <id> | reopen <id>
  launchpad task archive <id> | unarchive <id>
  launchpad task move <id> up|down
  launchpad task tag <id> <name> | untag <id> <name>

IDEAS
  launchpad idea add "<title>" [--body …] [--priority …] [--tags a,b]
  launchpad idea update <id> [--title …] [--body …] [--priority …] [--tags a,b]
  launchpad idea promote <id>          Turn it into a task (idea kept, marked promoted)
  launchpad idea archive <id> | unarchive <id>
  launchpad idea tag <id> <name> | untag <id> <name>

NOTES
  launchpad note add "<body>" [--title "…"] [--tags a,b]
  launchpad note update <id> [--title …] [--body …] [--tags a,b]
  launchpad note pin <id> | unpin <id>
  launchpad note archive <id> | unarchive <id>
  launchpad note tag <id> <name> | untag <id> <name>

INBOX (quick captures not yet filed to a project)
  launchpad inbox [--json]
  launchpad inbox file <captureId> --as task|idea|note [--project p]
  launchpad inbox clear                Mark everything processed

BATCH PUSH — the fast way to set a project up
  launchpad push <plan.json|-> [--dry-run] [--json]

  Plan schema (every field optional except item titles):
  {
    "project": { "description": "…", "status": "active", "tags": ["web", "react"] },
    "tasks":  [ { "title": "…", "body": "…", "priority": "high",
                  "status": "todo", "dueDate": "2026-08-01", "tags": ["bug"] } ],
    "ideas":  [ { "title": "…", "body": "…", "priority": "medium", "tags": [] } ],
    "notes":  [ { "title": "…", "body": "…", "pinned": false, "tags": [] } ]
  }

  · Items match existing ones by title (case/whitespace-insensitive) — or pass "id" to be exact.
  · Fields you omit are left alone. Nothing is ever deleted.
  · "project.tags" REPLACES the project's tag set; an item's "tags" replaces that item's set.
  · A title matching an ARCHIVED item is skipped with a warning, not recreated.
  · A full database backup is written before every real (non-dry-run) apply.

TYPICAL SETUP RUN
  launchpad onboard
  launchpad audit
  # read README, ai-instructions/*, TODOs in the code, then:
  launchpad push plan.json --dry-run
  launchpad push plan.json

ENVIRONMENT
  LAUNCHPAD_URL       Service base URL (default http://localhost:7420)
  LAUNCHPAD_PROJECT   Default project id or name
  LAUNCHPAD_ACTOR     Name recorded against your writes (or use --by "<name>")
`

async function cmdGuide() {
  out(GUIDE)
}

async function cmdPing() {
  const health = await getJson('/api/health')
  const stale = (Number(health?.apiVersion) || 0) < REQUIRES_API
  emit({ ...health, cliRequiresApi: REQUIRES_API, stale }, () => {
    out(`✓ Launchpad is up at ${BASE}  (api v${health.apiVersion})`)
    // "Up" and "usable" are different questions, and ping is where the difference should
    // surface — it is the command someone runs when something else has already gone wrong.
    if (stale) out(`! ${tooOldMessage(health.apiVersion).split('\n').join('\n  ')}`)
  })
}

async function cmdWhoami() {
  const binding = findBinding()
  const project = await resolveProject(FLAGS)
  const via = FLAGS.project ? '--project flag' : binding ? binding.file : 'cwd path match'
  emit({ ...project, resolvedVia: via }, () => {
    out(`${project.name}  (Launchpad project #${project.id})`)
    out(`  path:     ${project.path}`)
    out(`  resolved: ${via}`)
    out(`  service:  ${BASE}`)
  })
}

async function cmdBind(positional) {
  const needle = positional[1] ?? FLAGS.project
  if (!needle || needle === true) {
    throw new CliError('Usage: launchpad bind "<project name or id>"')
  }
  const project = await findByNameOrId(needle)
  if (!project) throw new CliError(`No project matching "${needle}". Try: launchpad list`)
  const file = writeBinding(project)
  emit({ projectId: project.id, name: project.name, file }, () => {
    out(`✓ This folder is now bound to "${project.name}" (#${project.id})`)
    out(`  → ${file}`)
  })
}

async function cmdUnbind() {
  const binding = findBinding()
  if (!binding) throw new CliError('This folder is not bound to a project.')
  writeFileSync(binding.file, '{}\n', 'utf-8')
  out(`✓ Unbound (cleared ${binding.file})`)
}

// Onboard always writes into the project's own folder, not the working directory, so it
// behaves the same whether you run it inside the project or target it with --project.
async function cmdOnboard() {
  const project = await resolveProject(FLAGS)
  if (!existsSync(project.path)) {
    throw new CliError(`Project folder does not exist: ${project.path}`)
  }
  const file = writeBinding(project, project.path)
  const instructions = await post(`/api/projects/${project.id}/agent-instructions`)
  const snapshot = await post(`/api/projects/${project.id}/export-file`)
  emit({ project, binding: file, instructions, snapshot }, () => {
    out(`✓ Onboarded "${project.name}" (#${project.id})`)
    out(`  binding:      ${file}`)
    out(`  instructions: ${instructions.path} (${instructions.action})`)
    out(`  snapshot:     ${snapshot.path}`)
    out('')
    out('Any agent working in that folder will now see the Launchpad block in CLAUDE.md.')
    out(`Next: launchpad audit --project ${project.id}`)
  })
}

// ---------------------------------------------------------------- commands: reading

async function cmdList() {
  const projects = await getJson('/api/projects')
  emit(projects, () => {
    if (projects.length === 0) return out('No projects registered.')
    const width = Math.max(...projects.map((p) => p.name.length))
    for (const p of projects) {
      const dirty = p.git?.dirty ? ' *' : ''
      out(
        `  #${String(p.id).padEnd(3)} ${p.name.padEnd(width)}  ${String(p.status).padEnd(8)}  ` +
          `${String(p.activity).padEnd(8)}  ${p.counts.openTasks}t/${p.counts.ideas}i/${p.counts.notes}n${dirty}`
      )
    }
    out(`\n${projects.length} project(s)${projects.some((p) => p.git?.dirty) ? '  (* = uncommitted changes)' : ''}`)
  })
}

async function cmdStatus() {
  const project = await resolveProject(FLAGS)
  emit(project, () => {
    out(`${project.name}  #${project.id}  [${project.status}]  activity: ${project.activity}`)
    out(`  path:   ${project.path}`)
    if (project.description) out(`  about:  ${project.description}`)
    if (project.tags.length) out(`  tags:   ${project.tags.map((t) => t.name).join(', ')}`)
    if (project.git.hasGit) {
      out(
        `  git:    ${project.git.branch || '?'} · ${project.git.dirty ? 'uncommitted changes' : 'clean'}` +
          (project.git.lastCommitAt ? ` · last commit ${project.git.lastCommitAt.slice(0, 10)}` : '')
      )
    }
    out(`  counts: ${project.counts.openTasks} open tasks, ${project.counts.ideas} ideas, ${project.counts.notes} notes`)
  })
}

async function cmdPull(flags = FLAGS) {
  const project = await resolveProject(flags)
  const data = await getJson(`/api/projects/${project.id}/export`)

  if (flags.json) {
    out(JSON.stringify(data, null, 2))
    return
  }

  const markdown = await (await api(`/api/projects/${project.id}/export.md`)).text()
  if (flags.print) {
    stdout.write(markdown)
    return
  }

  const dir = join(cwd(), 'ai-instructions')
  mkdirSync(dir, { recursive: true })
  const mdPath = join(dir, 'LAUNCHPAD.md')
  writeFileSync(mdPath, markdown, 'utf-8')
  writeFileSync(join(cwd(), SNAPSHOT_FILE), JSON.stringify(data, null, 2), 'utf-8')
  if (!existsSync(join(cwd(), BINDING_FILE))) writeBinding(project)

  if (flags.quiet) return
  out(`✓ Pulled "${project.name}" (#${project.id}) from Launchpad`)
  out(`  ${data.tasks.length} open task(s), ${data.ideas.length} idea(s), ${data.notes.length} note(s)`)
  out(`  → ${mdPath}`)
}

async function cmdAudit() {
  if (FLAGS.all) {
    const audits = await getJson('/api/audit')
    emit(audits, () => {
      if (audits.length === 0) return out('✓ Nothing missing across any project.')
      for (const a of audits) {
        out(`\n#${a.projectId} ${a.name}  [${a.status}]`)
        for (const issue of a.issues) out(`  · ${issue.detail}`)
      }
      out(`\n${audits.length} project(s) need attention.`)
    })
    return
  }
  const project = await resolveProject(FLAGS)
  const audit = await getJson(`/api/projects/${project.id}/audit`)
  emit(audit, () => {
    out(`${audit.name}  #${audit.projectId}  [${audit.status}]`)
    if (audit.issues.length === 0) return out('  ✓ Nothing missing.')
    for (const issue of audit.issues) out(`  · ${issue.detail}`)
  })
}

async function cmdSearch(positional) {
  const q = positional.slice(1).join(' ').trim()
  if (!q) throw new CliError('Usage: launchpad search "<query>"')
  const hits = await getJson(`/api/search?q=${encodeURIComponent(q)}`)
  emit(hits, () => {
    if (hits.length === 0) return out('No matches.')
    for (const h of hits) {
      out(`  ${h.type.padEnd(7)} #${String(h.id).padEnd(4)} ${h.projectName} — ${h.title}`)
      if (h.snippet) out(`          ${h.snippet}`)
    }
  })
}

async function cmdTimeline(positional) {
  const week = flagText('week') ?? positional[1] ?? 'this'
  const params = new URLSearchParams({ week })
  if (bool(FLAGS.mine, false)) params.set('mine', 'true')
  if (bool(FLAGS.refresh, false)) params.set('refresh', 'true')
  const t = await getJson(`/api/timeline?${params.toString()}`)
  emit(t, () => {
    const projects = t.projects.length
    out(`${t.week.label}  (${t.week.key})${t.mine ? '  · only mine' : ''}`)
    if (t.total === 0) {
      out(`  No commits${t.week.isFuture ? ' — that week has not happened yet' : ''}. Looked at ${t.reposScanned} repo(s).`)
    } else {
      out(`  ${t.total} commit(s) in ${projects} project(s): ${t.projects.map((p) => `${p.projectName} ${p.total}`).join(' · ')}`)
      out()
      for (const day of t.days) {
        if (day.total === 0) {
          out(`${day.label}  —`)
          continue
        }
        out(`${day.label}  (${day.total})`)
        for (const p of day.projects) {
          out(`  ${p.projectName} (#${p.projectId})`)
          for (const c of p.commits) {
            const time = new Date(c.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
            out(`    ${time}  ${c.hash}  ${c.subject}${t.authors.length > 1 ? `  — ${c.author}` : ''}`)
          }
        }
      }
    }
    for (const s of t.skipped) out(`  ! skipped ${s.projectName} (#${s.projectId}): ${s.reason}`)
    out(`\nprev: ${t.week.prev}  next: ${t.week.next}`)
  })
}

async function cmdLog() {
  const params = new URLSearchParams()
  if (FLAGS.limit && FLAGS.limit !== true) params.set('limit', String(FLAGS.limit))
  if (FLAGS.source && FLAGS.source !== true) params.set('source', String(FLAGS.source))
  if (!FLAGS.all) {
    const project = await resolveProject(FLAGS)
    params.set('projectId', String(project.id))
  }
  const entries = await getJson(`/api/changes?${params.toString()}`)
  emit(entries, () => {
    if (entries.length === 0) return out('No changes recorded.')
    for (const e of entries) {
      const who = e.actor ? `${e.source}/${e.actor}` : e.source
      out(`  ${e.at.slice(0, 19).replace('T', ' ')}  ${who.padEnd(16)} ${e.action.padEnd(10)} ${e.entityType} ${e.entityId ?? ''} ${e.summary}`)
    }
  })
}

// ---------------------------------------------------------------- commands: project writes

async function cmdSet(positional) {
  const field = positional[1]
  const value = positional.slice(2).join(' ').trim()
  const project = await resolveProject(FLAGS)
  if (field === 'description') {
    if (!value) throw new CliError('Usage: launchpad set description "<text>"')
    const updated = await patch(`/api/projects/${project.id}`, { description: value })
    emit(updated, () => out(`✓ Description set on "${project.name}"`))
  } else if (field === 'status') {
    const allowed = ['active', 'idea', 'on-hold', 'done', 'archived']
    if (!allowed.includes(value)) {
      throw new CliError(`Usage: launchpad set status <${allowed.join('|')}>`)
    }
    const updated = await patch(`/api/projects/${project.id}`, { status: value })
    emit(updated, () => out(`✓ "${project.name}" is now ${value}`))
  } else if (field === 'port') {
    if (!value) throw new CliError('Usage: launchpad set port <number|none>')
    const clearing = ['none', 'null', 'clear', 'off'].includes(value.toLowerCase())
    const port = clearing ? null : Number(value)
    if (!clearing && !Number.isInteger(port)) {
      throw new CliError('Usage: launchpad set port <number|none>')
    }
    // `set port` means "this project runs on exactly this port" — it replaces every claim.
    // Use `ports add` for a project that runs several processes.
    const result = await claimOrExplain(`/api/projects/${project.id}/port`, {
      port,
      label: flagText('label'),
      force: FLAGS.force === true
    })
    emit(result, () => {
      if (clearing) return out(`✓ Released every dev port for "${project.name}"`)
      // The project as it was before the call, so "what did this replace?" is answerable.
      const replaced = (project.ports ?? []).filter((p) => p.port !== port)
      out(`✓ "${project.name}" claims port ${port}  →  http://localhost:${port}`)
      if (replaced.length > 0) {
        out(`  (replaced ${replaced.map((p) => p.port).join(', ')} — use \`ports add\` to keep several)`)
      }
      if (result.warning) out(`  ! ${result.warning}`)
      out(`  Now configure the dev server to use ${port}.`)
    })
  } else {
    throw new CliError('Usage: launchpad set description|status|port "<value>"')
  }
}

async function cmdRename(positional) {
  const name = positional.slice(1).join(' ').trim()
  if (!name) throw new CliError('Usage: launchpad rename "<new name>"')
  const project = await resolveProject(FLAGS)
  const updated = await patch(`/api/projects/${project.id}`, { name })
  emit(updated, () => out(`✓ Renamed "${project.name}" → "${name}"`))
}

async function cmdScan() {
  const project = await resolveProject(FLAGS)
  const updated = await post(`/api/projects/${project.id}/scan`)
  emit(updated, () => out(`✓ Rescanned "${updated.name}" — activity: ${updated.activity}`))
}

async function cmdRegister(positional) {
  const path = positional[1]
  if (!path) throw new CliError('Usage: launchpad register <path> [--name "<name>"]')
  const name =
    FLAGS.name && FLAGS.name !== true ? String(FLAGS.name) : parsePath(path.replace(/[\\/]$/, '')).base
  const project = await post('/api/projects', { name, path })
  emit(project, () => out(`✓ Registered "${project.name}" as #${project.id}`))
}

async function cmdTag(positional) {
  const action = positional[1]
  const name = positional.slice(2).join(' ').trim()
  const project = await resolveProject(FLAGS)
  if (action === 'add') {
    if (!name) throw new CliError('Usage: launchpad tag add <name> [--color "#78716c"]')
    const color = FLAGS.color && FLAGS.color !== true ? String(FLAGS.color) : undefined
    const updated = await post(`/api/projects/${project.id}/tags`, { name, color })
    emit(updated, () => out(`✓ Tagged "${project.name}" with ${name}`))
  } else if (action === 'rm' || action === 'remove') {
    if (!name) throw new CliError('Usage: launchpad tag rm <name>')
    const tag = project.tags.find((t) => t.name.toLowerCase() === name.toLowerCase())
    if (!tag) throw new CliError(`"${project.name}" isn't tagged "${name}"`)
    const updated = await del(`/api/projects/${project.id}/tags/${tag.id}`)
    emit(updated, () => out(`✓ Removed tag ${name} from "${project.name}"`))
  } else {
    throw new CliError('Usage: launchpad tag add|rm <name>')
  }
}

// ---------------------------------------------------------------- commands: ports

function printPortOverview(overview) {
  // Defaulted rather than assumed: the version guard in main() should have caught an old
  // service long before here, but a missing field must degrade to "nothing claimed", never
  // to a TypeError about `.map` of undefined that hides what actually went wrong.
  const claims = overview?.claims ?? []
  const unclaimed = overview?.unclaimed ?? []
  const listening = overview?.listening ?? []
  const suggested = overview?.suggested ?? []
  const claimedSet = new Set(claims.map((c) => c.port))

  if (claims.length === 0) {
    out('No project claims a dev port yet.  →  launchpad ports detect')
  } else {
    const width = Math.max(...claims.map((c) => c.projectName.length))
    out('Project dev ports')
    for (const c of claims) {
      const label = c.label ? `  [${c.label}]` : ''
      const source = c.source ? `  (${c.source})` : ''
      const flags = [
        c.reserved ? "! reserved — Launchpad's own port" : '',
        (c.conflictsWith ?? []).length > 0 ? `! also claimed by ${c.conflictsWith.join(', ')}` : ''
      ].filter(Boolean)
      out(
        `  #${String(c.projectId).padEnd(3)} ${c.projectName.padEnd(width)}  ${String(c.port).padEnd(5)} ` +
          `${c.listening ? '● live' : '○ idle'}  ${c.url}${label}${source}${flags.length ? `  ${flags.join('  ')}` : ''}`
      )
    }
  }

  if (unclaimed.length > 0) {
    out('')
    out(`No port claimed (${unclaimed.length})`)
    out(`  ${unclaimed.map((p) => p.name).join(', ')}`)
    out('  → launchpad ports detect --project "<name>"')
  }

  // Everything else holding a port on this machine — the answer to "what is on 4200?"
  // Windows hands out 49152+ to outbound sockets and RPC, so those are noise, not servers.
  const foreign = listening.filter((port) => !claimedSet.has(port))
  const notable = foreign.filter((port) => port < 49152)
  if (notable.length > 0) {
    out('')
    out(`In use on this machine, claimed by no project (${notable.length})`)
    for (let i = 0; i < notable.length; i += 14) out(`  ${notable.slice(i, i + 14).join(', ')}`)
    const dynamic = foreign.length - notable.length
    if (dynamic > 0) out(`  (+${dynamic} more in the dynamic range above 49152 — not dev servers)`)
  }

  out('')
  out(`Free to claim: ${suggested.join(', ') || '(none found)'}`)
}

async function cmdPorts(positional) {
  const action = positional[1]

  if (action === 'check') {
    const port = Number(positional[2])
    if (!Number.isFinite(port)) throw new CliError('Usage: launchpad ports check <port>')
    const result = await getJson(`/api/ports/check?port=${port}`)
    emit(result, () => {
      out(`${result.available ? '✓' : '✗'} Port ${result.port} — ${result.available ? 'free to claim' : 'not available'}`)
      out(`  ${result.reason}`)
      out(`  listening: ${result.listening ? 'yes' : 'no'}   claimed by: ${result.claimedBy || '(nobody)'}`)
    })
    return
  }

  if (action === 'free') {
    const count = FLAGS.count !== undefined && FLAGS.count !== true ? Number(FLAGS.count) : 3
    const result = await getJson(`/api/ports/suggest?count=${Number.isFinite(count) ? count : 3}`)
    emit(result, () => {
      if (result.ports.length === 0) return out('No free ports found in the suggestion range.')
      out(`Free ports: ${result.ports.join(', ')}`)
      // Spelled out because "free" has two meanings here and only one of them is obvious:
      // nothing is listening AND no project has claimed it in Launchpad.
      const { claimed, listening, reserved } = result.skipped
      const skipped = [
        claimed.length > 0 ? `${claimed.length} already claimed (${claimed.join(', ')})` : '',
        listening.length > 0 ? `${listening.length} in use` : '',
        reserved.length > 0 ? `${reserved.length} reserved` : ''
      ].filter(Boolean)
      if (skipped.length > 0) out(`  Skipped on the way: ${skipped.join(', ')}.`)
      out(`  Claim one with: launchpad ports add ${result.ports[0]}`)
    })
    return
  }

  if (action === 'detect') {
    const project = await resolveProject(FLAGS)
    const result = await post(`/api/projects/${project.id}/detect-port`)
    emit(result, () => {
      const claimed = result?.claimed ?? []
      const skipped = result?.skipped ?? []
      for (const claim of claimed) {
        out(`✓ "${project.name}" claims http://localhost:${claim.port}  (from ${claim.source})`)
      }
      for (const skip of skipped) {
        out(`✗ ${skip.port} declared in ${skip.source} but not claimed: ${skip.reason}`)
      }
      if (claimed.length === 0 && skipped.length === 0) {
        out(`No dev port declared in "${project.name}"'s config files.`)
        out('  → launchpad ports free, then: launchpad ports add <number>')
      }
    })
    return
  }

  // A project that runs several processes claims several ports; `add`/`rm` touch one claim
  // and leave the rest alone, unlike `set port`, which replaces them all.
  if (action === 'add') {
    const port = Number(positional[2])
    if (!Number.isFinite(port)) {
      throw new CliError('Usage: launchpad ports add <port> [--label "web"] [--force]')
    }
    const project = await resolveProject(FLAGS)
    const result = await claimOrExplain(`/api/projects/${project.id}/ports`, {
      port,
      label: flagText('label'),
      force: FLAGS.force === true
    })
    emit(result, () => {
      const label = result.claim.label ? ` [${result.claim.label}]` : ''
      out(`✓ "${project.name}" claims port ${port}${label}  →  http://localhost:${port}`)
      const all = result.project.ports.map((p) => p.port)
      if (all.length > 1) out(`  Now holding ${all.join(', ')} (primary: ${all[0]}).`)
      if (result.warning) out(`  ! ${result.warning}`)
      out(`  Now configure that process to use ${port}.`)
    })
    return
  }

  if (action === 'rm' || action === 'remove') {
    const port = Number(positional[2])
    if (!Number.isFinite(port)) throw new CliError('Usage: launchpad ports rm <port>')
    const project = await resolveProject(FLAGS)
    const updated = await del(`/api/projects/${project.id}/ports/${port}`)
    emit(updated, () => {
      out(`✓ "${project.name}" released port ${port}`)
      const all = updated.ports.map((p) => p.port)
      out(all.length > 0 ? `  Still holding ${all.join(', ')}.` : '  It now claims no ports.')
    })
    return
  }

  if (action === 'label') {
    const port = Number(positional[2])
    const label = positional.slice(3).join(' ').trim()
    if (!Number.isFinite(port)) throw new CliError('Usage: launchpad ports label <port> "<what runs on it>"')
    const project = await resolveProject(FLAGS)
    const claim = await patch(`/api/projects/${project.id}/ports/${port}`, { label })
    emit(claim, () => out(`✓ ${port} is "${claim.label || '(unlabelled)'}" for "${project.name}"`))
    return
  }

  // Which port "open localhost" and the agent block mean when a project holds several.
  if (action === 'primary') {
    const port = Number(positional[2])
    if (!Number.isFinite(port)) throw new CliError('Usage: launchpad ports primary <port>')
    const project = await resolveProject(FLAGS)
    const updated = await post(`/api/projects/${project.id}/ports/order`, { ports: [port] })
    emit(updated, () => out(`✓ "${project.name}" leads with ${updated.ports.map((p) => p.port).join(', ')}`))
    return
  }

  if (action !== undefined && action !== 'list') {
    throw new CliError(
      'Usage: launchpad ports [list|check <port>|free|detect|add <port>|rm <port>|label <port> "<text>"|primary <port>]'
    )
  }

  const overview = await getJson('/api/ports')
  emit(overview, () => printPortOverview(overview))
}

async function cmdTags() {
  const tags = await getJson('/api/tags')
  emit(tags, () => {
    if (tags.length === 0) return out('No tags yet.')
    for (const t of tags) out(`  #${String(t.id).padEnd(3)} ${t.name.padEnd(20)} ${t.color}`)
  })
}

// ---------------------------------------------------------------- commands: items

const KINDS = {
  task: { segment: 'tasks', label: 'Task', print: printTask },
  idea: { segment: 'ideas', label: 'Idea', print: printIdea },
  note: { segment: 'notes', label: 'Note', print: printNote }
}

function itemPatchFromFlags(kind) {
  const p = {}
  if (FLAGS.title !== undefined && FLAGS.title !== true) p.title = String(FLAGS.title)
  if (FLAGS.body !== undefined && FLAGS.body !== true) p.body = String(FLAGS.body)
  if (FLAGS.priority !== undefined && FLAGS.priority !== true) p.priority = String(FLAGS.priority)
  if (FLAGS.status !== undefined && FLAGS.status !== true) p.status = String(FLAGS.status)
  if (kind === 'task' && FLAGS.due !== undefined) p.dueDate = FLAGS.due === true ? null : String(FLAGS.due)
  if (kind === 'note' && FLAGS.pinned !== undefined) p.pinned = bool(FLAGS.pinned, true)
  const tags = list(FLAGS.tags)
  if (tags) p.tags = tags
  return p
}

async function cmdItemList(kind) {
  const { segment, print } = KINDS[kind]
  const project = await resolveProject(FLAGS)
  const items = await getJson(
    `/api/projects/${project.id}/${segment}${FLAGS.all ? '?includeArchived=true' : ''}`
  )
  emit(items, () => {
    if (items.length === 0) return out(`No ${segment} in "${project.name}".`)
    out(`${project.name} — ${items.length} ${segment}`)
    for (const item of items) print(item)
  })
}

async function cmdItem(kind, positional) {
  const { segment, label, print } = KINDS[kind]
  const action = positional[1]
  const rest = positional.slice(2)
  const id = Number(rest[0])

  if (!action || action === 'list') return cmdItemList(kind)

  if (action === 'add') {
    const project = await resolveProject(FLAGS)
    const text = rest.length > 0 ? rest.join(' ').trim() : ''
    const payload = itemPatchFromFlags(kind)
    if (kind === 'note') {
      if (!text && !payload.body) throw new CliError(`Usage: launchpad note add "<text>" [--title "…"]`)
      if (text) payload.body = text
    } else {
      if (!text && !payload.title) throw new CliError(`Usage: launchpad ${kind} add "<title>" [--body "…"]`)
      if (text) payload.title = text
    }
    const created = await post(`/api/projects/${project.id}/${segment}`, payload)
    emit(created, () => {
      out(`✓ ${label} #${created.id} added to "${project.name}"`)
      print(created)
    })
    return
  }

  if (action === 'get') {
    if (!Number.isFinite(id)) throw new CliError(`Usage: launchpad ${kind} get <id>`)
    const item = await getJson(`/api/${segment}/${id}`)
    emit(item, () => print(item))
    return
  }

  if (action === 'update') {
    if (!Number.isFinite(id)) throw new CliError(`Usage: launchpad ${kind} update <id> [--title …] [--body …]`)
    const payload = itemPatchFromFlags(kind)
    // Bare text after the id is treated as the title (or body, for notes).
    const text = rest.slice(1).join(' ').trim()
    if (text) payload[kind === 'note' ? 'body' : 'title'] = text
    if (Object.keys(payload).length === 0) throw new CliError('Nothing to update — pass --title/--body/--priority/--status/--due/--tags')
    const updated = await patch(`/api/${segment}/${id}`, payload)
    emit(updated, () => {
      out(`✓ ${label} #${id} updated`)
      print(updated)
    })
    return
  }

  if (action === 'archive' || action === 'unarchive') {
    if (!Number.isFinite(id)) throw new CliError(`Usage: launchpad ${kind} ${action} <id>`)
    const item = await post(`/api/${segment}/${id}/archive`, { archived: action === 'archive' })
    emit(item, () => out(`✓ ${label} #${id} ${action}d`))
    return
  }

  if (action === 'tag' || action === 'untag') {
    const name = rest.slice(1).join(' ').trim()
    if (!Number.isFinite(id) || !name) throw new CliError(`Usage: launchpad ${kind} ${action} <id> <tag>`)
    if (action === 'tag') {
      const item = await post(`/api/${segment}/${id}/tags`, { name })
      emit(item, () => out(`✓ ${label} #${id} tagged "${name}"`))
    } else {
      const item = await getJson(`/api/${segment}/${id}`)
      const tag = item.tags.find((t) => t.name.toLowerCase() === name.toLowerCase())
      if (!tag) throw new CliError(`${label} #${id} isn't tagged "${name}"`)
      const updated = await del(`/api/${segment}/${id}/tags/${tag.id}`)
      emit(updated, () => out(`✓ Removed tag "${name}" from ${label} #${id}`))
    }
    return
  }

  if (action === 'tags') {
    const names = list(rest.slice(1).join(',')) ?? []
    if (!Number.isFinite(id)) throw new CliError(`Usage: launchpad ${kind} tags <id> <a,b,c>`)
    const updated = await put(`/api/${segment}/${id}/tags`, { names })
    emit(updated, () => out(`✓ ${label} #${id} tags set to: ${names.join(', ') || '(none)'}`))
    return
  }

  // ---- kind-specific verbs ----
  if (kind === 'task' && (action === 'done' || action === 'reopen')) {
    if (!Number.isFinite(id)) throw new CliError(`Usage: launchpad task ${action} <id>`)
    const updated = await patch(`/api/tasks/${id}`, { status: action === 'done' ? 'done' : 'todo' })
    emit(updated, () => out(`✓ Task #${id} ${action === 'done' ? 'completed' : 'reopened'}: ${updated.title}`))
    return
  }

  if (kind === 'task' && action === 'move') {
    const direction = rest[1] === 'up' ? 'up' : 'down'
    if (!Number.isFinite(id)) throw new CliError('Usage: launchpad task move <id> up|down')
    await post(`/api/tasks/${id}/move`, { direction })
    out(`✓ Task #${id} moved ${direction}`)
    return
  }

  if (kind === 'idea' && action === 'promote') {
    if (!Number.isFinite(id)) throw new CliError('Usage: launchpad idea promote <id>')
    const task = await post(`/api/ideas/${id}/promote`)
    emit(task, () => out(`✓ Idea #${id} promoted → task #${task.id}: ${task.title}`))
    return
  }

  if (kind === 'note' && (action === 'pin' || action === 'unpin')) {
    if (!Number.isFinite(id)) throw new CliError(`Usage: launchpad note ${action} <id>`)
    const updated = await patch(`/api/notes/${id}`, { pinned: action === 'pin' })
    emit(updated, () => out(`✓ Note #${id} ${action}ned`))
    return
  }

  throw new CliError(`Unknown ${kind} command "${action}". Run: launchpad guide`)
}

// ---------------------------------------------------------------- commands: inbox

async function cmdInbox(positional) {
  const action = positional[1]

  if (!action || action === 'list') {
    const captures = await getJson('/api/captures')
    const open = captures.filter((c) => !c.processed)
    emit(open, () => {
      if (open.length === 0) return out('Inbox is empty.')
      for (const c of open) {
        out(`  #${String(c.id).padEnd(4)} ${c.kind.padEnd(5)} ${c.text}${c.url ? `  (${c.url})` : ''}`)
      }
      out(`\n${open.length} unfiled capture(s)`)
    })
    return
  }

  if (action === 'file') {
    const id = Number(positional[2])
    if (!Number.isFinite(id)) throw new CliError('Usage: launchpad inbox file <captureId> --as task|idea|note')
    const as = FLAGS.as && FLAGS.as !== true ? String(FLAGS.as) : 'task'
    if (!KINDS[as]) throw new CliError('--as must be task, idea or note')
    const captures = await getJson('/api/captures')
    const capture = captures.find((c) => c.id === id)
    if (!capture) throw new CliError(`No capture #${id}`)
    const project = await resolveProject(FLAGS)
    const payload =
      as === 'note' ? { title: '', body: capture.text } : { title: capture.text, body: '' }
    const created = await post(`/api/projects/${project.id}/${KINDS[as].segment}`, payload)
    await patch(`/api/captures/${id}`, { processed: true })
    emit(created, () => out(`✓ Capture #${id} filed into "${project.name}" as ${as} #${created.id}`))
    return
  }

  if (action === 'clear') {
    const captures = await getJson('/api/captures')
    const open = captures.filter((c) => !c.processed)
    for (const c of open) await patch(`/api/captures/${c.id}`, { processed: true })
    out(`✓ Marked ${open.length} capture(s) processed`)
    return
  }

  throw new CliError('Usage: launchpad inbox [list|file <id> --as task|idea|note|clear]')
}

// ---------------------------------------------------------------- commands: push

async function cmdPush(positional) {
  const source = positional[1]
  if (!source) {
    throw new CliError('Usage: launchpad push <plan.json|-> [--dry-run]\n  (see `launchpad guide` for the plan schema)')
  }
  let raw
  try {
    raw = source === '-' ? readFileSync(0, 'utf-8') : readFileSync(source, 'utf-8')
  } catch {
    throw new CliError(`Cannot read plan: ${source}`)
  }
  let plan
  try {
    plan = JSON.parse(raw)
  } catch (e) {
    throw new CliError(`Plan is not valid JSON: ${e.message}`)
  }

  const project = await resolveProject(FLAGS)
  const dryRun = FLAGS['dry-run'] === true || FLAGS.dryRun === true
  const result = await post(
    `/api/projects/${project.id}/push${dryRun ? '?dryRun=true' : ''}`,
    plan
  )

  emit(result, () => {
    out(
      `${dryRun ? 'DRY RUN — nothing written' : '✓ Pushed'} to "${result.projectName}" (#${result.projectId})`
    )
    out(`  ${result.created} created · ${result.updated} updated · ${result.unchanged} unchanged`)
    for (const c of result.changes) {
      if (c.action === 'unchanged') continue
      const fields = c.fields.length > 0 ? `  (${c.fields.join(', ')})` : ''
      out(`   ${c.action === 'created' ? '+' : '~'} ${c.type} ${c.id ? `#${c.id}` : ''} ${c.title}${fields}`)
    }
    for (const w of result.warnings) out(`   ! ${w}`)
    if (result.backupPath) out(`  backup: ${result.backupPath}`)
    if (dryRun) out('\n  Re-run without --dry-run to apply.')
  })
}

// ---------------------------------------------------------------- router

const COMMANDS = {
  guide: cmdGuide,
  help: cmdGuide,
  ping: cmdPing,
  whoami: cmdWhoami,
  bind: (p) => cmdBind(p),
  unbind: cmdUnbind,
  onboard: cmdOnboard,
  list: cmdList,
  projects: cmdList,
  status: cmdStatus,
  pull: () => cmdPull(FLAGS),
  audit: cmdAudit,
  timeline: (p) => cmdTimeline(p),
  search: (p) => cmdSearch(p),
  log: cmdLog,
  set: (p) => cmdSet(p),
  rename: (p) => cmdRename(p),
  scan: cmdScan,
  register: (p) => cmdRegister(p),
  tag: (p) => cmdTag(p),
  tags: cmdTags,
  ports: (p) => cmdPorts(p),
  task: (p) => cmdItem('task', p),
  tasks: () => cmdItemList('task'),
  idea: (p) => cmdItem('idea', p),
  ideas: () => cmdItemList('idea'),
  note: (p) => cmdItem('note', p),
  notes: () => cmdItemList('note'),
  inbox: (p) => cmdInbox(p),
  push: (p) => cmdPush(p)
}

async function main() {
  const { positional, flags } = parseArgs(argv.slice(2))
  FLAGS = flags
  const command = positional[0] || (flags.help ? 'guide' : 'pull')
  const handler = COMMANDS[command]
  if (!handler) {
    console.error(`Unknown command: ${command}\n`)
    out(GUIDE)
    exit(1)
  }
  try {
    // `guide` is offline text and `ping` is the diagnostic that has to answer *whatever*
    // the service turns out to be — everything else needs a service it can actually talk to.
    if (command !== 'guide' && command !== 'ping') await assertApiVersion()
    await handler(positional)
  } catch (e) {
    console.error(`✗ ${e.message}`)
    // Set the code and let the loop drain rather than tearing the process down mid-socket;
    // see the note in api(). A refused port claim is an ordinary outcome and has to leave a
    // clean exit 1 behind it.
    process.exitCode = 1
  }
}

main()
