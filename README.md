# CC Rules

CC Rules is a Claude Code plugin for rules you can actually see and edit. Rules don't stay hidden
in the back end of a chat: they live in plain Markdown checklists, at three levels. Every chat loads them, and when you
say "make a rule for this chat", Claude updates that list and tells you exactly what changed.

```markdown
# Global rules

- [x] R1: Always answer in plain English
- [ ] R2: Use British spelling
- [x] R5: Show the command before running anything that deletes files
```

`[x]` means the rule is active and `[ ]` means it's paused. Each rule has an ID (R1, R2...) that never changes and is
never reused, even when the rule moves to another level.

**Where it works:** Claude Code only. That means the terminal, the IDE extensions and the desktop app's Code tab. It
doesn't run in the desktop app's Chat or Cowork modes or on claude.ai: Chat ignores plugin hooks, and Cowork runs them
in a sandbox that can't see the rule files on your computer. For rules there, use Settings → General → **Instructions
for Claude** (every chat) and each Project's instructions.

## Three levels

| Level | Applies to | File |
| --- | --- | --- |
| **Global** (highest) | every chat | `~/.claude/cc-rules/GLOBAL.md` |
| **Project** | every chat in the project | `~/.claude/cc-rules/projects/<group name>.md` |
| **Chat** (lowest) | this one chat | `~/.claude/cc-rules/chats/<chat name>.md` |

**If two rules conflict, the higher level wins:** global over project, project over chat. A chat rule can't override
a global rule; to make an exception, change the global rule itself.

**A project is a sidebar group** in the Claude desktop app's Code tab, such as "Apps" or "Websites". File a chat under
a group and that group's rules apply to it. Move it to another group and its project rules switch over. A chat in no
group, or a chat outside the desktop app, uses the folder it runs in, with project rules in
`<folder>/.claude/cc-rules/PROJECT.md`.

## Rules follow renames

Project and chat files are named after the group and the chat, so you can find them, but they're linked by ID, not by
name. Each file has a line like this:

```
Linked to chat fb541091-576b-4bda-88ad-efd4920bb2a5. Keep this line: it ties the file to the chat, even after renames.
```

When you rename a chat or a sidebar group, CC Rules renames its file and heading to match at the next message, and
the rules carry on applying. You'll see a note such as `Renamed the rules file for this chat to match its name:
Login bug final fix.md`. Two chats with the same name get `Name.md` and `Name (2).md`.

Folder projects keep their file inside the folder, so it moves with the folder if you rename or move it.

## What you see

When a chat starts, Claude Code shows a short list of the active rules:

```
CC Rules: 3 active
  R1 (global) Always answer in plain English
  R3 (project) Use metric units
  R4 (this chat) Keep replies under 200 words
1 paused · project: Apps · /rules to see or change them
```

Before each message, CC Rules checks whether anything changed since Claude last saw the rules. That covers a hand
edit, a renamed chat or group, or a chat filed under another group. When something did, Claude gets the updated
rules and you see what changed:

```
CC Rules updated:
  This chat is now in project "Websites".
  R7 (project) now applies: Mobile first
  R3 (project) no longer applies
```

When nothing changed, it stays silent. The check takes a fraction of a second.

## The CC Rules panel

To see the rules without asking, use the **CC Rules panel**. It's a pane in the Code tab that lists every rule
at all three levels:

```
Global · every chat                                   open file
 ●  R1  Always answer in plain English                 [Pause]
 ○  R2  Use British spelling                           [Resume]

Project · Apps (sidebar group)                        no file yet
 No rules yet.

This chat · Fix login bug                             open file
 ●  R4  Keep replies under 200 words                   [Pause]
```

- It opens by itself when a chat starts. If you close it, it stays closed in later chats until you type `/rules`
  on its own, which opens it again.
- It keeps itself up to date. Hand edits, renamed chats and groups, a chat filed under another group, and
  Claude's own changes all show within a few seconds.
- **Pause** and **Resume** switch a rule at a click. Claude is told about the change at your next message, and so
  are you.
- **open file** opens that level's Markdown file. To add, reword or move a rule, ask Claude (it checks for
  conflicts first) or edit the file.
- A status line entry, `CC Rules: 3 active`, shows the count where your Claude Code shows plugin status.

Plugins can't add buttons to the Code tab's own toolbar, so the panel opens from a chat start or `/rules`.
The desktop app decides where to place it: docked beside the chat, or above the message box. The panel is a Claude
Code mod, which is an early-access feature; if your version doesn't show it, everything else still works.

## Finding hidden rules

Rules also hide outside CC Rules, where the panel can't show them, and Claude still follows the ones in files it
loads. **Find hidden rules**, at the bottom of the panel, looks in:

- Claude Code's own instruction files: `CLAUDE.md`, `CLAUDE.local.md` and `AGENTS.md`, plus `.claude/rules/`. It checks
  your user folder (`~/.claude`), the chat's folder, every folder above it, and folders up to three levels below it.
  It skips dependency and build folders such as `node_modules`.
- "Feedback" notes in Claude's memory (`~/.claude/projects/*/memory`): the lessons it saved about how you work.
- Markdown files with "rules" in the name, such as an exported list of rules.
- Files left over from Chat Rules, this plugin's old name.

In a rules file, every list item counts. In a mixed file such as `CLAUDE.md`, only a short line that reads as an
instruction counts ("Never push to main", "Ask before deleting files"). Lines under headings such as "Things learned
the hard way" or "Architecture" don't, because notes on how a program works usually belong where they are.

A rule CC Rules already has (the same words, at any level, in any project or chat) isn't listed.

Each rule found shows its file, line and heading, an **Assign to…** list and a **Remove** button. Picking from the
list sends the rule there at once and takes it out of its file:

- **Global (every chat)**
- **The project it was written for**: the sidebar group of the program it belongs to, marked *suggested*
- **The chat it was written for**: that program's own chat, also *suggested*
- **This chat**
- **Any other project**
- **Keep it where it is**: leaves it and stops listing it. **Keep all** does that for every rule found in one file.

To suggest a project and chat, CC Rules works out which program a rule belongs to: from a heading such as "Project:
Benchdrop", the folder its `CLAUDE.md` sits in, or the program a memory note was saved for. It then finds the desktop
chats with that program's name or folder. A chat named exactly that wins over one that only contains it, and a long
name one or two letters off (a typo) still matches. A rule under a "Global" heading, or in your own `~/.claude`, gets
Global marked *suggested*. **Remove** takes the rule out of its file without adding it anywhere.

Once the list is up, **Find hidden rules** becomes **Look again**, and **Undo last change** appears beside it. Every move
and removal backs up the file first, in `~/.claude/cc-rules/.backups/`. **Undo last change** puts the latest one back, including taking a moved rule back out of CC Rules. A memory note that's moved or removed goes into the
backup along with its line in `MEMORY.md`. You can also ask Claude: "find my hidden rules".

## Making and changing rules

Just ask in your own words, or use `/rules` (also available as `/cc-rules:rules`):

| You say | What happens |
| --- | --- |
| "make a rule for this chat: keep replies under 200 words" | `Added R4 to this chat: Keep replies under 200 words` |
| "make a rule for this project: use metric units" | `Added R3 to project "Apps": Use metric units` |
| "make a rule for every chat: always answer in plain English" | `Added R1 to global rules: Always answer in plain English` |
| `/rules` on its own | opens the panel (or, where the panel can't run, the table below) |
| `/rules list` or "what rules are active?" | a table of every rule with its ID, level and status, and where the files are |
| "change R4 to under 300 words" | `Edited R4 in this chat: ... (was: ...)` |
| "pause R2", "resume R2" | `Paused R2 in global rules: ...` |
| "remove R4" | `Removed R4 from this chat: ...` |
| "make R4 global", "move R3 to this chat" | `Moved R4 from this chat to global rules: ...` |

"Make a rule" with no level means this chat. Every change is echoed back with its ID and level.

**Conflicts.** Before adding, editing, resuming or moving a rule, Claude re-reads every file and compares the rule with
the active rules at all three levels. If it contradicts one, Claude makes no change yet. It shows you both rules and
asks which wins: keep the old rule, or use the new one and pause or remove the old one. It also tells you when the
level order matters: a new chat rule can't beat an active global rule, and pausing a global rule affects every chat.
Exact duplicates are refused outright, with a pointer to the existing rule.

## Editing the files by hand

- One rule per checklist line: `- [x] R3: text`. Also accepted: `*` or `+` bullets, `[X]`, `[]` (paused), `R3 -`,
  `R3.` and lowercase `r3`. When Claude next changes that line, it rewrites it as `- [x] R3: text`.
- Add a rule without an ID (`- [x] Always cite sources`) and it gets the next free ID at the next message. You'll see
  a note saying so.
- If you copy a line and end up with the same ID twice, the copy at the lower level (or further down) gets a new ID.
- A plain bullet with no box (`- Always cite sources`) isn't a rule. CC Rules points it out so you can add the box.
- Lines inside code blocks and `<!-- comments -->` are ignored. Your headings, notes and blank lines are never
  touched, except that a heading starting `# Project rules` or `# Chat rules` is kept in step with the name.
- Don't delete the `Linked to ...` line: it's how the file stays tied to its group or chat. If you create a project
  or chat file yourself, name it after the group or chat (say `projects/Apps.md`); CC Rules adopts it and adds the line.
- Old chat files stay until you delete them.

## Install

You need Claude Code, Node.js 22 or later, and, on Windows, Git Bash (Claude Code's usual shell for hooks).

**From GitHub.** In Claude Code 2.1.275 or later, type:

```
/plugin install cc-rules --marketplace Griffith-Software/CC-Rules
```

Or, from your shell:

```bash
claude plugin marketplace add Griffith-Software/CC-Rules
```

```bash
claude plugin install cc-rules@cc-rules
```

**From the zip.** Unzip `CCRules_v<version>.zip` somewhere it can stay, such as your Documents folder. The `CCRules`
folder inside is its own plugin marketplace, and Claude Code runs the plugin from it, so keep the folder:

```bash
claude plugin marketplace add "/path/to/CCRules"
```

```bash
claude plugin install cc-rules@cc-rules
```

**Try it for one session** without installing:

```bash
claude --plugin-dir "/path/to/CCRules"
```

**After a new version**, update the install, then start a new chat. If you installed from the zip, unzip the new
version over the old folder first.

```bash
claude plugin update cc-rules@cc-rules
```

### If `node` isn't on your PATH

Point the plugin at Node with its **Node.js path** option. You can give the full path to `node.exe` or the folder it's
in. Set it when you install:

```bash
claude plugin install cc-rules@cc-rules --config "node_path=C:/path/to/node-v22-win-x64/node.exe"
```

Or set it later:

```bash
echo '{"node_path": "C:/path/to/node-v22-win-x64/node.exe"}' | claude plugin configure cc-rules@cc-rules --values-stdin
```

If the hooks can't find Node, they don't break the chat. At chat start you'll see "CC Rules: Node.js wasn't found,
so no rules were loaded", with the fix.

## Command line

Claude runs `scripts/rules.js` for you, but you can run it too:

```
node scripts/rules.js [--root DIR] [--session ID] <command> [args]

  list                          every rule with its ID, level and status
  add <text>                    add a rule to this chat
      --level project|global    ...or to this project, or to every chat
      --paused                  add it switched off
      --title <text>            name for this chat's file, if the chat has no name yet
  edit <ID> <text>              change a rule's wording
  remove <ID>...                delete rules
  pause <ID>...                 switch rules off (the line stays, unchecked)
  resume <ID>...                switch rules back on
  move <ID>... --to global|project|chat
  context                       the text Claude gets when a chat starts

  scan                          list hidden rules, each with an ID like H1a2b3c
  adopt <ID> --to <target>      move one into CC Rules: global, project, chat,
                                group:<id or name> for another sidebar group,
                                or session:<id> for another chat; keep = leave it
  clean <ID>                    take one out of its file
  keep <ID>...                  leave them where they are and stop listing them
  undo                          put back the latest adopt or clean
```

Rule text can also come from `--text "..."` or `--stdin`. `--root` is the chat's folder and `--session` its session
ID. Every command re-reads the files first. Errors exit with code 1 and a plain message.

## How it works

| Piece | Job |
| --- | --- |
| `hooks/hooks.json` | runs the two hooks: at chat start (also resume, `/clear`, compaction) and before each message |
| `scripts/run-node.sh` | finds Node (plugin option, then PATH) and starts a hook |
| `scripts/session-start.js` | loads all three levels; gives Claude the active rules and you a short list |
| `scripts/prompt-check.js` | before each message: renames, group moves, hand edits; silent when nothing changed |
| `hooks/panel.tsx` | the CC Rules panel (a Claude Code mod), opened by `/rules` on its own, and the status line entry |
| `types/index.d.ts` | the panel's state contract |
| `skills/rules/SKILL.md` | the `/rules` skill: re-read, check for conflicts, change, echo |
| `scripts/rules.js` | the command line that makes every change |
| `scripts/lib/where.js` | works out a chat's three files: global, its project (group or folder) and its own |
| `scripts/lib/desktop.js` | finds the desktop app's data folder and reads the chat's name and sidebar group from it |
| `scripts/lib/rulebook.js` | parsing, IDs, renames and line-by-line rewrites |
| `scripts/lib/snapshot.js` | remembers what Claude was last told, in `~/.claude/cc-rules/.state/` |
| `scripts/lib/finder.js` | finds hidden rules, and moves, removes, keeps and undoes them, with backups in `.backups/` |

Rule IDs come from one counter, `~/.claude/cc-rules/.next-id`. It never falls behind an ID already in use.

## What it reads and changes

CC Rules runs only on your computer. It has no server, makes no network connections and collects nothing.

It reads:

- its own rule files in `~/.claude/cc-rules/`, and `.claude/cc-rules/PROJECT.md` in a chat's folder
- the desktop app's settings file and its record of each Code chat, for the chat's name and sidebar group
- the chat's transcript, only for the newest chat name Claude Code recorded there
- when you use **Find hidden rules**: `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` and `.claude/rules/` in your user
  folder, the chat's folder, the folders above it and up to three levels below it; Claude's memory notes in
  `~/.claude/projects/*/memory/`; Markdown files with "rules" in the name; and files left over from Chat Rules

It writes to `~/.claude/cc-rules/` (rule files, the ID counter, `.state/` with what Claude was last told in each chat,
and `.backups/`), and to `.claude/cc-rules/PROJECT.md` when you add a folder project rule. It changes a file anywhere
else only when you move or remove a hidden rule: it backs the file up first, then takes the rule's line out (a memory
note moves into the backup), and **Undo last change** puts it back. The panel also remembers whether you closed it,
in Claude Code's own plugin storage.

## Limits

- **Sidebar groups and chat names come from the desktop app's own files, which aren't an official interface.** The
  app has moved them once already (October 2026, to `%LOCALAPPDATA%\Claude-Data\claude_<package>` on Windows), so
  CC Rules finds them from the Claude Code the app started instead of assuming a folder. If it still can't find or
  read them, chats fall back to folder project rules and you see a warning saying so; chat names then come from
  Claude Code's transcript.
- Chat rules belong to one chat. Resuming a chat keeps them; `/clear` starts a new chat with no chat rules.
- Renames are noticed at the next message (or `/rules` command), not the instant you rename.
- Claude decides whether two rules contradict each other, so a subtle conflict can slip past. The tool itself only
  catches exact duplicates.
- Claude Code caps what a hook can add to the context at 10,000 characters, roughly 100 typical rules. Past that,
  Claude Code saves the text to a file and shows Claude a preview.
- On Windows the hooks run through `sh`, which comes with Git Bash.

## Development

No dependencies. From this folder:

```bash
node --test "tests/*.test.js"
```

```bash
node tools/package.js
```

The tests run in throwaway folders with a fake desktop app, so they never touch your real rules or settings. The
panel's tests (`tests/panel.test.tsx`) run with Claude Code's own plugin test runner (2.1.299 or later), against a
fake rules tool:

```bash
claude plugin test .
```

`node tools/package.js` checks that the versions match in `plugin.json`, `marketplace.json`, `package.json` and
`CHANGELOG.md`. It then writes `../CCRules_v<version>.zip`, with everything under a top-level `CCRules/` folder, reads
the archive back to verify it, and writes its SHA-256 to `../CCRules_v<version>.zip.sha256`. `claude plugin validate .` checks the manifests.

Environment overrides, used by the tests: `CC_RULES_HOME` (rules home), `CC_RULES_DESKTOP_DIR` (desktop app data)
and `CLAUDE_CONFIG_DIR` (Claude Code's config folder, for transcripts). Last checked against Claude Code 2.1.308.

## Licence

CC Rules is free to use, change and share under the Apache License 2.0 with the Commons Clause, which doesn't allow
selling it. That makes it source-available rather than open source. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
