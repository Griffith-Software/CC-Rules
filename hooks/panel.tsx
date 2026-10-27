// CC Rules panel: a pane that shows this chat's rules at all three levels
// (global, project, this chat), keeps itself up to date, and pauses or
// resumes a rule at a click. /rules on its own opens it; it also opens by itself
// when a chat starts, unless the person closed it by hand last time.
//
// "Find hidden rules" lists rules that live outside CC Rules (CLAUDE.md files,
// .claude/rules, Claude's memory, rules files, old Chat Rules files). Each has
// an "Assign to…" list (Global, the project and chat it seems written for,
// this chat, any other project, or keep it where it is) and a Remove button.
// Every move and removal is backed up first; "Undo last change" puts it back.
//
// Everything goes through the plugin's own command line (scripts/rules.js),
// so the panel and /rules always agree. Its calls pass --no-snapshot: Claude
// hasn't seen a change made here, so the check before the next message tells
// Claude (and the person) about it.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { HiddenItem, RuleLevel, RulesView, ScanView } from '../types'

const PANE = 'cc-rules'
const TITLE = 'CC Rules'
// $.store key, kept across sessions: the person closed the pane by hand.
const CLOSED = 'panel-closed'
// How often to look for hand edits, renames and group moves.
const POLL_MS = 4000

const view = atom({ plugin: 'cc-rules', key: 'view' } as const, null)
const problem = atom({ plugin: 'cc-rules', key: 'problem' } as const, null)
const hidden = atom({ plugin: 'cc-rules', key: 'hidden' } as const, null)

const HEADINGS: Record<RuleLevel['level'], string> = {
  global: 'Global · every chat',
  project: 'Project',
  chat: 'This chat',
}

// Claude Code 2.1.299 added Text's `weight`, `size` and `tabular` and Box's
// named spacing steps, and deprecated `bold`. An older Claude Code refuses a
// drawing with props it doesn't know, so the panel draws the old way there.
function textStylesFor(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = version.split(/[.-]/).map(Number)
  return major !== 2 ? major > 2 : minor !== 1 ? minor > 1 : patch >= 299
}

function looks(modern: boolean) {
  return modern
    ? { heading: { size: 'heading', weight: 'semibold' }, id: { weight: 'semibold', tabular: true }, gap: 'md', rowGap: 'sm', error: 'error' } as const
    : { heading: { bold: true }, id: { bold: true }, gap: 1, rowGap: 1, error: 'red' } as const
}

// The plugin's "Node.js path" option: the program itself or the folder it's
// in. Empty means the node on PATH.
async function nodeBin($: EngineInterface, options: PluginOptions): Promise<string> {
  const set = typeof options.node_path === 'string' ? options.node_path.trim() : ''
  if (!set) return 'node'
  try {
    if ((await $.fs.stat(set)).kind === 'dir') {
      for (const name of ['node.exe', 'node']) {
        const candidate = `${set}/${name}`
        try {
          if ((await $.fs.stat(candidate)).kind === 'file') return candidate
        } catch {
          // try the next name
        }
      }
    }
  } catch {
    // Not there: running it says so.
  }
  return set
}

async function runRules($: EngineInterface, options: PluginOptions, args: readonly string[]) {
  const [node, root, session] = await Promise.all([nodeBin($, options), $.session.root(), $.session.id()])
  const argv = [node, `${$.plugin.root}/scripts/rules.js`, '--root', root, '--session', session, ...args, '--no-snapshot']
  return $.process.run(argv, { timeoutMs: 15000 })
}

function countActive(data: RulesView): number {
  return data.levels.reduce((sum, level) => sum + level.rules.filter(rule => rule.active).length, 0)
}

async function refresh($: EngineInterface, options: PluginOptions): Promise<void> {
  try {
    const ran = await runRules($, options, ['list', '--json'])
    if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `rules.js exited ${ran.exitCode}`)
    const data = JSON.parse(ran.stdout) as RulesView
    await update($, view, () => data)
    await update($, problem, () => null)
    $.ui.status(`CC Rules: ${countActive(data)} active`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await update($, problem, () => message)
  }
}

// One stamp for every file the panel depends on, so a change to any of them
// (a hand edit, a renamed chat or group, a move to another group) shows up.
async function stampOf($: EngineInterface, files: readonly string[]): Promise<string> {
  const parts = await Promise.all(
    files.map(async file => {
      try {
        const stat = await $.fs.stat(file)
        return `${stat.mtimeMs}:${stat.size}`
      } catch {
        return 'none'
      }
    }),
  )
  return parts.join('|')
}

// Runs one change and toasts what the command line said about it.
async function run($: EngineInterface, options: PluginOptions, args: readonly string[], toast?: string) {
  const ran = await runRules($, options, args)
  const said = (ran.exitCode === 0 ? ran.stdout : ran.stderr).trim().replace(/^Error: /, '')
  if (toast && ran.exitCode === 0) $.ui.toast(toast)
  else if (said) $.ui.toast(said.split('\n')[0])
  return ran.exitCode === 0
}

async function act($: EngineInterface, options: PluginOptions, command: 'pause' | 'resume', id: string) {
  await run($, options, [command, id])
  await refresh($, options)
}

async function findHidden($: EngineInterface, options: PluginOptions): Promise<void> {
  const ran = await runRules($, options, ['scan', '--json'])
  if (ran.exitCode !== 0) {
    $.ui.toast(ran.stderr.trim().replace(/^Error: /, '') || "Couldn't look for hidden rules.")
    return
  }
  await update($, hidden, () => JSON.parse(ran.stdout) as ScanView)
}

// A change to a hidden rule, then a fresh look at both lists.
async function changeHidden($: EngineInterface, options: PluginOptions, args: readonly string[], toast?: string) {
  await run($, options, args, toast)
  await Promise.all([findHidden($, options), refresh($, options)])
}

// The value of a rule's "Assign to…" list before anything is picked.
const CHOOSE = 'choose'

// A pick from a rule's list: send it there, or keep it where it is.
async function assign($: EngineInterface, options: PluginOptions, id: string, value: string) {
  if (value === CHOOSE) return
  await changeHidden($, options, value === 'keep' ? ['keep', id] : ['adopt', id, '--to', value])
}

function skipped(found: ScanView): string {
  return [
    found.assigned ? `${found.assigned} already in CC Rules` : '',
    found.ignored ? `${found.ignored} kept where they are` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

function fileLink(level: RuleLevel): string {
  if (!level.exists) return 'no file yet'
  return `[open file](${encodeURI(`file:///${level.file.replace(/^\/+/, '')}`)})`
}

function heading(level: RuleLevel, data: RulesView): string {
  if (level.level === 'project') {
    const kind = data.project.kind === 'group' ? 'sidebar group' : 'folder'
    return `Project · ${data.project.name} (${kind})`
  }
  if (level.level === 'chat' && data.chatTitle) return `This chat · ${data.chatTitle}`
  return HEADINGS[level.level]
}

// /rules typed on its own, by its bare name or as the plugin's own.
function opensPanel(command: string, args: string): boolean {
  return (command === 'rules' || command === 'cc-rules:rules') && args.trim() === ''
}

async function openPanel($: EngineInterface, options: PluginOptions): Promise<void> {
  await $.store.delete(CLOSED)
  await refresh($, options)
  await $.ui.open({ id: PANE, title: TITLE })
}

function byFile(items: readonly HiddenItem[]): [string, HiddenItem[]][] {
  const groups = new Map<string, HiddenItem[]>()
  for (const item of items) groups.set(item.label, [...(groups.get(item.label) ?? []), item])
  return [...groups.entries()]
}

export const register: Register = (on, options) => {
  let lastStamp = ''
  let isChecking = false
  // Whether this Claude Code has 2.1.299's text styles. Until session start
  // finds out, draw what every version accepts (newer ones still take `bold`).
  let modern = false

  on('session.start', async ($, e, next) => {
    try {
      modern = textStylesFor((await $.session.version()).version)
    } catch {
      // Unknown version: keep the styles every version accepts.
    }
    // A plugin update reloads this module mid-chat, and the chat keeps what
    // the old one found: a hidden-rules list that may be stale or in an older
    // shape. Drop it; "Find hidden rules" looks again.
    await update($, hidden, () => null)
    await refresh($, options)
    lastStamp = await stampOf($, (await read($, view))?.watch ?? [])
    $.clock.every(POLL_MS, () => {
      if (isChecking) return
      isChecking = true
      void (async () => {
        try {
          const stamp = await stampOf($, (await read($, view))?.watch ?? [])
          if (stamp !== lastStamp) {
            await refresh($, options)
            lastStamp = await stampOf($, (await read($, view))?.watch ?? [])
          }
        } finally {
          isChecking = false
        }
      })()
    })
    if (!(await $.store.get(CLOSED))) void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  // /rules typed on its own opens the panel, answered here without Claude.
  // With anything after it (/rules add ..., /rules list), and wherever the
  // panel isn't running, the /rules skill goes to Claude as before.
  on('command.run', async ($, e, next) => {
    if (!opensPanel(e.command, e.args)) return next(e)
    await openPanel($, options)
    return { text: 'CC Rules panel opened.' }
  })

  // Claude may have changed the rules during its turn. Subagents' turns end
  // here too (they have an agentId); only the main conversation changes rules.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) await refresh($, options)
    return done
  })

  // Closed by hand: stay closed in later chats until /rules opens it. The close
  // always goes ahead; failing to remember it only means it reopens next chat.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE && e.origin.kind === 'person') {
      try {
        await $.store.set(CLOSED, true)
      } catch {
        // see above
      }
    }
    return closed
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown, Select } = $.ui.resolve(e)
    const data = await read($, view)
    const trouble = await read($, problem)
    const found = await read($, hidden)
    const look = looks(modern)

    if (!data) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{trouble ? "Couldn't read the rules." : 'Loading the rules…'}</Text>
          {trouble && <Text color={look.error}>{trouble}</Text>}
          {trouble && <Text dimColor>Check the plugin's Node.js path: claude plugin configure cc-rules@cc-rules</Text>}
          <Button key="refresh" label="Try again" onPress={() => void refresh($, options)} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={look.gap}>
        {data.levels.map(level => (
          <Box key={`level-${level.level}`} flexDirection="column">
            <Box flexDirection="row" justifyContent="space-between">
              <Text {...look.heading}>{heading(level, data)}</Text>
              <Markdown key={`file-${level.level}`} text={fileLink(level)} dimColor />
            </Box>
            {level.rules.length === 0 && <Text dimColor>  No rules yet.</Text>}
            {level.rules.map(rule => (
              <Box key={`row-${rule.id}`} flexDirection="row" gap={look.rowGap}>
                <Text dimColor={!rule.active}>{rule.active ? '●' : '○'}</Text>
                <Text {...look.id} dimColor={!rule.active}>
                  {rule.id}
                </Text>
                <Box flexGrow={1} flexShrink={1}>
                  <Text dimColor={!rule.active} strikethrough={!rule.active}>
                    {rule.text}
                  </Text>
                </Box>
                <Button
                  key={`toggle-${rule.id}`}
                  label={rule.active ? 'Pause' : 'Resume'}
                  onPress={() => void act($, options, rule.active ? 'pause' : 'resume', rule.id)}
                />
              </Box>
            ))}
          </Box>
        ))}
        <Text dimColor>Higher levels win: global › project › this chat. Ask Claude to add, edit or move rules.</Text>
        {data.notices.map((notice, index) => (
          <Text key={`notice-${index}`} dimColor>
            Note: {notice}
          </Text>
        ))}
        {trouble && <Text color={look.error}>Couldn't refresh: {trouble}</Text>}
        <Box flexDirection="row" gap={look.rowGap}>
          <Button key="refresh" label="Refresh" onPress={() => void refresh($, options)} />
          <Button key="find-hidden" label={found ? 'Look again' : 'Find hidden rules'} onPress={() => void findHidden($, options)} />
          {found && (
            <Button key="hidden-undo" label="Undo last change" onPress={() => void changeHidden($, options, ['undo'])} />
          )}
        </Box>

        {found && (
          <Box key="hidden" flexDirection="column" gap={look.rowGap}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text {...look.heading}>Hidden rules · {found.items.length} found</Text>
              <Button key="hidden-close" label="Close" onPress={() => void update($, hidden, () => null)} />
            </Box>
            <Text dimColor>
              Rules outside CC Rules: in CLAUDE.md files, .claude/rules, Claude's memory, rules files and old Chat Rules
              files. Pick where each one goes from its list, which suggests the project and chat it was written for; or
              Remove it from its file.
            </Text>
            {skipped(found) && <Text dimColor>Not listed: {skipped(found)}.</Text>}
            {found.items.length === 0 && <Text dimColor>No hidden rules found.</Text>}
            {byFile(found.items).map(([label, items], index) => (
              <Box key={`hidden-file-${index}`} flexDirection="column">
                <Box flexDirection="row" justifyContent="space-between">
                  <Text {...look.id}>{label}</Text>
                  <Button
                    key={`keep-all-${index}`}
                    label="Keep all"
                    onPress={() =>
                      void changeHidden(
                        $,
                        options,
                        ['keep', ...items.map(item => item.id)],
                        `Kept ${items.length} in ${label}; they won't be listed again.`,
                      )
                    }
                  />
                </Box>
                {items.map(item => (
                  <Box key={`hidden-${item.id}`} flexDirection="column">
                    <Text dimColor>
                      {item.section ? `under "${item.section}" · ` : ''}line {item.line}
                    </Text>
                    <Text>{item.text}</Text>
                    <Box flexDirection="row" gap={look.rowGap}>
                      <Select
                        key={`assign-${item.id}`}
                        value={CHOOSE}
                        options={[
                          { key: CHOOSE, value: CHOOSE, label: 'Assign to…' },
                          ...item.targets.map(t => ({ key: t.value, value: t.value, label: t.label })),
                        ]}
                        onSelect={value => void assign($, options, item.id, value)}
                      />
                      <Button key={`remove-${item.id}`} label="Remove" onPress={() => void changeHidden($, options, ['clean', item.id])} />
                    </Box>
                  </Box>
                ))}
              </Box>
            ))}
            <Text dimColor>Every move and removal backs up the file first, in ~/.claude/cc-rules/.backups.</Text>
          </Box>
        )}
      </Box>
    )
  })
}
