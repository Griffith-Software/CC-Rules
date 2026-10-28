// Tests for the CC Rules panel (hooks/panel.tsx), run by Claude Code's own
// plugin test runner: claude plugin test <CCRules folder>
// The rules command line is faked with a process.run hook, so these never
// read or change real rule files.
import { expect, mock, test } from 'claude-code/testing'

const VIEW = {
  project: { kind: 'group', name: 'Apps' },
  chatTitle: 'Fix login bug',
  levels: [
    {
      level: 'global',
      label: 'global rules',
      file: 'C:/x/GLOBAL.md',
      exists: true,
      rules: [{ id: 'GR1', active: true, text: 'Always answer in plain English' }],
    },
    { level: 'project', label: 'project "Apps"', file: 'C:/x/projects/Apps.md', exists: false, rules: [] },
    {
      level: 'chat',
      label: 'this chat',
      file: 'C:/x/chats/Fix login bug.md',
      exists: true,
      rules: [{ id: 'CR1', active: false, text: 'Keep replies short' }],
    },
  ],
  notices: ['Gave the new rule on line 3 of GLOBAL.md the ID GR1: Always answer in plain English'],
  watch: [],
}

const PANE = {
  component: 'Pane',
  requestId: 'cc-rules',
  props: {
    title: 'CC Rules',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

type On = Parameters<Parameters<typeof test>[1]>[1]

// The world beneath the panel: a session, a store, and a screen that places
// panes and takes status lines and toasts.
function world(on: On) {
  mock.store(on)
  on('session.root', async () => ({ value: 'C:/Projects/Site' }))
  on('session.id', async () => ({ value: 'test-session' }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
}

const TARGETS = [
  { value: 'global', label: 'Global (every chat)' },
  { value: 'group:cg-web', label: 'Project: Websites · suggested' },
  { value: 'session:site-chat', label: 'Chat: Site · suggested' },
  { value: 'chat', label: 'This chat: Fix login bug' },
  { value: 'project', label: 'Project: Apps' },
  { value: 'keep', label: 'Keep it where it is' },
]

const SCAN = {
  items: [
    { id: 'H111111', kind: 'line', label: 'notes/RULES-EXPORT.md', line: 5, section: 'Global (every chat)', text: 'Never add AI credits.', targets: TARGETS },
    { id: 'H222222', kind: 'line', label: 'notes/RULES-EXPORT.md', line: 6, section: 'Global (every chat)', text: 'Ask before deleting files.', targets: TARGETS },
    { id: 'H333333', kind: 'line', label: 'Site/CLAUDE.md', line: 9, section: 'Working here', text: 'Show the diff before pushing.', targets: TARGETS },
  ],
  assigned: 1,
  ignored: 2,
}

function fakeRules(on: On, runs: string[][], scan: object = SCAN) {
  world(on)
  on('process.run', async (_$, e) => {
    runs.push([...e.argv])
    const stdout = e.argv.includes('scan')
      ? JSON.stringify(scan)
      : e.argv.includes('--json')
        ? JSON.stringify(VIEW)
        : 'Paused GR1 in global rules: Always answer in plain English\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

test('the panel shows all three levels on every surface that docks it', async ($, on) => {
  const runs: string[][] = []
  fakeRules(on, runs)
  await $.command.run({ command: 'rules', args: '' })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'cc-rules', surface, ...PANE })
    expect(await ui.find({ text: 'Global · every chat' })).toBeDefined()
    expect(await ui.find({ text: 'Project · Apps (sidebar group)' })).toBeDefined()
    expect(await ui.find({ text: 'This chat · Fix login bug' })).toBeDefined()
    expect(await ui.find({ text: 'Always answer in plain English' })).toBeDefined()
    expect(await ui.find({ text: 'No rules yet.' })).toBeDefined()
    expect((await ui.find({ key: 'toggle-GR1' }))?.text).toBe('Pause')
    expect((await ui.find({ key: 'toggle-CR1' }))?.text).toBe('Resume')
    for (const key of ['row-GR1', 'row-CR1']) {
      expect((await ui.find({ key }))?.props).toEqual(expect.objectContaining({ borderStyle: 'round', borderDimColor: true }))
    }
    expect(await ui.find({ text: /Note: Gave the new rule/ })).toBeDefined()
    await ui.unmount()
  }
  const list = runs.find(argv => argv.includes('--json'))
  expect(list).toEqual(expect.arrayContaining(['list', '--json', '--no-snapshot', '--session']))
})

test('Pause runs the rules tool without telling the snapshot, then refreshes', async ($, on) => {
  const runs: string[][] = []
  fakeRules(on, runs)
  await $.command.run({ command: 'rules', args: '' })
  const ui = await $.ui.mount({ plugin: 'cc-rules', surface: 'desktop', ...PANE })
  const before = runs.length
  await ui.press({ key: 'toggle-GR1' })
  const after = runs.slice(before)
  expect(after[0]).toEqual(expect.arrayContaining(['pause', 'GR1', '--no-snapshot']))
  expect(after[1]).toEqual(expect.arrayContaining(['list', '--json']))
  await ui.unmount()
})

test('Find hidden rules lists them by file, each with its own list and a Remove button', async ($, on) => {
  const runs: string[][] = []
  fakeRules(on, runs)
  await $.command.run({ command: 'rules', args: '' })
  const ui = await $.ui.mount({ plugin: 'cc-rules', surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'assign-H111111' })).toBeUndefined()
  expect((await ui.find({ key: 'find-hidden' }))?.text).toBe('Find hidden rules')
  expect(await ui.find({ key: 'hidden-undo' })).toBeUndefined()
  await ui.press({ key: 'find-hidden' })
  expect((await ui.find({ key: 'find-hidden' }))?.text).toBe('Look again')
  expect((await ui.find({ key: 'hidden-undo' }))?.text).toBe('Undo last change')
  expect(await ui.find({ key: 'hidden-rescan' })).toBeUndefined()
  expect(runs.at(-1)).toEqual(expect.arrayContaining(['scan', '--json', '--no-snapshot']))
  expect(await ui.find({ text: 'Hidden rules · 3 found' })).toBeDefined()
  expect(await ui.find({ text: 'Not listed: 1 already in CC Rules · 2 kept where they are.' })).toBeDefined()
  expect(await ui.find({ text: 'notes/RULES-EXPORT.md' })).toBeDefined()
  expect(await ui.find({ text: 'under "Global (every chat)" · line 5' })).toBeDefined()
  const list = await ui.find({ key: 'assign-H333333' })
  expect(list?.type).toBe('Select')
  expect((list?.props.options as { label: string }[]).map(o => o.label)).toEqual([
    'Assign to…',
    'Global (every chat)',
    'Project: Websites · suggested',
    'Chat: Site · suggested',
    'This chat: Fix login bug',
    'Project: Apps',
    'Keep it where it is',
  ])
  expect((await ui.find({ key: 'remove-H333333' }))?.text).toBe('Remove')
  expect((await ui.find({ key: 'hidden-H333333' }))?.props.borderStyle).toBe('round')
  expect(await ui.find({ key: 'hidden-target' })).toBeUndefined()
  await ui.unmount()
})

test('Picking from a rule\'s list sends it there, or keeps it, then looks again', async ($, on) => {
  const runs: string[][] = []
  fakeRules(on, runs)
  await $.command.run({ command: 'rules', args: '' })
  const ui = await $.ui.mount({ plugin: 'cc-rules', surface: 'desktop', ...PANE })
  await ui.press({ key: 'find-hidden' })
  let before = runs.length
  await ui.select({ key: 'assign-H333333', value: 'session:site-chat' })
  let after = runs.slice(before)
  expect(after[0]).toEqual(expect.arrayContaining(['adopt', 'H333333', '--to', 'session:site-chat', '--no-snapshot']))
  expect(after.some(argv => argv.includes('scan'))).toBe(true)
  expect(after.some(argv => argv.includes('list'))).toBe(true)
  before = runs.length
  await ui.select({ key: 'assign-H111111', value: 'keep' })
  after = runs.slice(before)
  expect(after[0]).toEqual(expect.arrayContaining(['keep', 'H111111']))
  before = runs.length
  await ui.press({ key: 'remove-H222222' })
  expect(runs.slice(before)[0]).toEqual(expect.arrayContaining(['clean', 'H222222']))
  await ui.unmount()
})

test('Keep all keeps every rule found in that file', async ($, on) => {
  const runs: string[][] = []
  fakeRules(on, runs)
  await $.command.run({ command: 'rules', args: '' })
  const ui = await $.ui.mount({ plugin: 'cc-rules', surface: 'desktop', ...PANE })
  await ui.press({ key: 'find-hidden' })
  const before = runs.length
  await ui.press({ key: 'keep-all-0' })
  const keep = runs.slice(before).find(argv => argv.includes('keep'))
  expect(keep).toEqual(expect.arrayContaining(['keep', 'H111111', 'H222222']))
  expect(keep).not.toContain('H333333')
  await ui.unmount()
})

// Chat start under a given Claude Code version, then the panel drawn on the desktop.
async function startedOn(version: string, $: Parameters<Parameters<typeof test>[1]>[0], on: On, scan?: object) {
  fakeRules(on, [], scan)
  mock.clock(on)
  on('session.version', async () => ({ value: { version } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:/Projects/Site', surface: 'desktop', isInteractive: true })
  return $.ui.mount({ plugin: 'cc-rules', surface: 'desktop', ...PANE })
}

test('on Claude Code 2.1.299 and later the panel uses the new text styles', async ($, on) => {
  const ui = await startedOn('2.1.308', $, on)
  const heading = await ui.find({ type: 'Text', text: 'Global · every chat' })
  // The engine reads weight and bold as one, so the heading size tells them apart.
  expect(heading?.props.size).toBe('heading')
  expect(heading?.props.weight).toBe('semibold')
  expect((await ui.find({ key: 'row-GR1' }))?.props.paddingX).toBe('sm')
  await ui.unmount()
})

test('on an older Claude Code the panel falls back to bold, which it still knows', async ($, on) => {
  const ui = await startedOn('2.1.287', $, on)
  const heading = await ui.find({ type: 'Text', text: 'Global · every chat' })
  expect(heading?.props.bold).toBe(true)
  expect(heading?.props.size).toBeUndefined()
  // Spacing steps are 2.1.299's too, so the box padding is in cells.
  expect((await ui.find({ key: 'row-GR1' }))?.props.paddingX).toBe(1)
  await ui.unmount()
})

// A plugin update reloads the panel mid-chat; the chat keeps what the old
// panel found, and 0.6.0's list had no per-rule targets.
test('a hidden-rules list from before a reload is dropped, so the panel still draws', async ($, on) => {
  const { targets, ...old } = SCAN.items[0]
  const ui = await startedOn('2.1.308', $, on, { items: [old], targets, ignored: 0 })
  await ui.press({ key: 'find-hidden' }).catch(() => undefined)
  await ui.unmount()
  await $.session.start({ cwd: 'C:/Projects/Site', surface: 'desktop', isInteractive: true })
  const again = await $.ui.mount({ plugin: 'cc-rules', surface: 'desktop', ...PANE })
  expect(await again.find({ text: 'Global · every chat' })).toBeDefined()
  expect(await again.find({ key: 'find-hidden' })).toBeDefined()
  expect(await again.find({ key: 'hidden-close' })).toBeUndefined()
  await again.unmount()
})

test('/rules on its own opens the panel by either of its names, without Claude', async ($, on) => {
  fakeRules(on, [])
  for (const command of ['rules', 'cc-rules:rules']) {
    expect((await $.command.run({ command, args: '' })).text).toBe('CC Rules panel opened.')
  }
})

test('/rules with anything after it goes on to the skill, as does any other command', async ($, on) => {
  fakeRules(on, [])
  on('command.run', async (_$, e) => ({ text: `ran ${e.command} ${e.args}` }))
  expect((await $.command.run({ command: 'rules', args: 'pause GR3' })).text).toBe('ran rules pause GR3')
  expect((await $.command.run({ command: 'cc-rules:rules', args: 'list' })).text).toBe('ran cc-rules:rules list')
  expect((await $.command.run({ command: 'compact', args: '' })).text).toBe('ran compact ')
})

test('a failing rules tool shows the problem and a way to retry', async ($, on) => {
  world(on)
  on('process.run', async () => ({
    value: { exitCode: 1, stdout: '', stderr: 'Error: node not found', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  await $.command.run({ command: 'rules', args: '' })
  const ui = await $.ui.mount({ plugin: 'cc-rules', surface: 'desktop', ...PANE })
  expect(await ui.find({ text: "Couldn't read the rules." })).toBeDefined()
  expect(await ui.find({ text: 'Error: node not found' })).toBeDefined()
  expect((await ui.find({ key: 'refresh' }))?.text).toBe('Try again')
  await ui.unmount()
})
