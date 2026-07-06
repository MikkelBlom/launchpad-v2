#!/usr/bin/env node
// Launchpad CLI — pull this project's notes/ideas/tasks from the local Launchpad
// service into ai-instructions/LAUNCHPAD.md so an AI agent working here can read them.
//
// Zero dependencies (Node 18+ global fetch). Install globally once with `npm link`
// (or `npm install -g .`) from the launchpad-v2 folder, then run `launchpad pull`
// from any registered project.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { argv, cwd, env, exit } from 'node:process'

const BASE = (env.LAUNCHPAD_URL || 'http://localhost:7420').replace(/\/$/, '')

function parseArgs(args) {
  const positional = []
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = args[i + 1]
      if (next && !next.startsWith('--')) {
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

async function api(path, init) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, init)
  } catch {
    throw new Error(
      `Cannot reach Launchpad at ${BASE}. Is the Launchpad app/service running? ` +
        `(override with LAUNCHPAD_URL)`
    )
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).error || ''
    } catch {
      /* ignore */
    }
    const err = new Error(`Launchpad API ${res.status}${detail ? `: ${detail}` : ''}`)
    err.status = res.status
    throw err
  }
  return res
}

async function resolveProject(flags) {
  if (flags.project) {
    const projects = await (await api('/api/projects')).json()
    const needle = String(flags.project).toLowerCase()
    const match =
      projects.find((p) => String(p.id) === needle) ||
      projects.find((p) => p.name.toLowerCase() === needle) ||
      projects.find((p) => p.name.toLowerCase().includes(needle))
    if (!match) throw new Error(`No project matching "${flags.project}"`)
    return match
  }
  try {
    return await (await api(`/api/projects/resolve?path=${encodeURIComponent(cwd())}`)).json()
  } catch (e) {
    if (e.status === 404) {
      throw new Error(
        `This folder isn't registered in Launchpad yet.\n` +
          `  → Add it in the Launchpad app (or set a project root and scan),\n` +
          `  → or target one explicitly:  launchpad pull --project "<name>"`
      )
    }
    throw e
  }
}

async function cmdPull(flags) {
  const project = await resolveProject(flags)
  const markdown = await (await api(`/api/projects/${project.id}/export.md`)).text()
  const data = await (await api(`/api/projects/${project.id}/export`)).json()

  if (flags.print) {
    process.stdout.write(markdown)
    return
  }

  const dir = join(cwd(), 'ai-instructions')
  mkdirSync(dir, { recursive: true })
  const mdPath = join(dir, 'LAUNCHPAD.md')
  const jsonPath = join(dir, '.launchpad.json')
  writeFileSync(mdPath, markdown, 'utf-8')
  writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8')

  console.log(`✓ Pulled "${project.name}" from Launchpad`)
  console.log(`  ${data.tasks.length} open task(s), ${data.ideas.length} idea(s), ${data.notes.length} note(s)`)
  console.log(`  → ${mdPath}`)
}

async function cmdStatus(flags) {
  const project = await resolveProject(flags)
  console.log(`${project.name}  [${project.status}]  activity: ${project.activity}`)
  console.log(`  path:   ${project.path}`)
  if (project.git.hasGit) {
    console.log(
      `  git:    ${project.git.branch || '?'} · ${project.git.dirty ? 'uncommitted changes' : 'clean'}` +
        (project.git.lastCommitAt ? ` · last commit ${project.git.lastCommitAt.slice(0, 10)}` : '')
    )
  }
  console.log(
    `  counts: ${project.counts.openTasks} open tasks, ${project.counts.ideas} ideas, ${project.counts.notes} notes`
  )
}

function printHelp() {
  console.log(`Launchpad CLI

Usage:
  launchpad pull [--project <name|id>] [--print]   Write ai-instructions/LAUNCHPAD.md for this project
  launchpad status [--project <name|id>]           Print this project's status
  launchpad help                                   Show this help

Environment:
  LAUNCHPAD_URL   Base URL of the Launchpad service (default http://localhost:7420)
`)
}

async function main() {
  const { positional, flags } = parseArgs(argv.slice(2))
  const command = positional[0] || 'pull'
  try {
    if (command === 'pull') await cmdPull(flags)
    else if (command === 'status') await cmdStatus(flags)
    else if (command === 'help' || flags.help) printHelp()
    else {
      console.error(`Unknown command: ${command}\n`)
      printHelp()
      exit(1)
    }
  } catch (e) {
    console.error(`✗ ${e.message}`)
    exit(1)
  }
}

main()
