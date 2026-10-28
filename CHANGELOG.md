# Changelog

## 1.1.0 (2026-10-28)

- **Each level numbers its own rules.** IDs now show the level: GR1, GR2... for global rules, PR1, PR2... for
  project rules and CR1, CR2... for chat rules. Each file counts from 1, so a rule in one project no longer leaves a
  gap in your global numbers.
- **No gaps.** IDs follow the order of the lines in the file. Remove or move a rule, or delete a line by hand, and
  the rules after it move up a number. The confirmation says which IDs changed (`Global rules renumbered: GR3–GR5
  are now GR2–GR4.`), and so does the check before your next message in every other open chat.
- A moved rule gets the next ID at its new level: `Moved CR1 from this chat to global rules as GR5`.
- `remove` and `move` with several IDs check them all before changing anything, and each ID means the rule you saw
  under it.
- **Undo last change** in Find hidden rules finds the moved rule by its wording, so it takes out the right rule
  even after the numbers have changed.
- An ID without the level letters (`R3` or `3`) means a global rule.
- Rules from 1.0.0 (`R3` at every level) get their new IDs the first time each file is read. Open chats are told
  which IDs changed, for example `Global rules renumbered: R1–R10 are now GR1–GR10, R12 is now GR11.`
- The shared ID counter (`~/.claude/cc-rules/.next-id`) is no longer used.
- **Panel: each rule sits in a thin box**, so rules that wrap onto several lines no longer run together like
  paragraphs. Hidden rules found by Find hidden rules get the same box.

## 1.0.0 (2026-10-27)

First public release. It works the same as 0.8.0.

- **Licence:** Apache License 2.0 with the Commons Clause. It's free to use, change and share, but not to sell.
  Earlier versions were MIT. A NOTICE file comes with it.
- **Install from GitHub** with `/plugin install cc-rules --marketplace Griffith-Software/CC-Rules`, or from the
  release zip. The README covers both.
- The README has a new "What it reads and changes" section. It lists every file CC Rules reads or writes. CC Rules
  makes no network connections.
- The release zip comes with a `.sha256` file for checking the download.

## 0.8.0 (2026-10-27)

- **One command.** `/rules` typed on its own opens the panel, straight away and without Claude. With anything after it
  (`/rules add …`, `/rules pause R3`, `/rules list`) it works as before. `/rules-panel` is gone, so Settings lists one
  skill.
- `/rules list` shows the rules table in the chat, which bare `/rules` used to do. Where the panel can't run, bare
  `/rules` still shows the table, and so does asking Claude ("what rules are active?").

## 0.7.3 (2026-10-27)

- `/rules-panel` is now a skill of its own, so the plugin's page in Settings lists it beside `/rules`. Before, the
  panel added the command itself when a chat started, which Settings doesn't see. Typing it still just opens the panel.
  Where the panel can't run, Claude says why and lists the rules instead.

## 0.7.2 (2026-10-27)

- Panel: once hidden rules are listed, **Find hidden rules** becomes **Look again** and **Undo last change** appears
  beside it at the top. The two buttons at the bottom of the list are gone.

## 0.7.1 (2026-10-27)

- **Fixed: the panel stayed blank after updating from 0.6.0** in a chat where Find hidden rules had been used.
  An update reloads the panel mid-chat, and the chat kept 0.6.0's list of hidden rules, which the new panel couldn't
  draw. The panel now starts with no list after a reload; Find hidden rules looks again.

## 0.7.0 (2026-10-27)

- **One list per hidden rule.** Each rule found has its own **Assign to…** list and a **Remove** button beside it,
  instead of one shared "Move to" list with Move, Remove and Keep on every rule. Picking from the list sends the rule
  there at once. The list offers Global, the project and the chat the rule was written for (marked *suggested*), this
  chat, every other project, and "Keep it where it is".
- **Suggestions.** CC Rules works out which program a rule belongs to: from its heading ("Project: Benchdrop", or two
  programs in one heading), the folder its `CLAUDE.md` is in, or the program a memory note was saved for. It then
  matches that to your desktop chats by name or folder: exact names first, and a typo of a letter or two still
  matches. The project is the sidebar group of the matching chat. Rules under a "Global" heading, or in your own
  `~/.claude`, suggest Global.
- **Rules CC Rules already has aren't listed**, at any level and in any project or chat. The panel says how many were
  left out.
- `adopt --to session:<id>` gives a rule to another chat, and `adopt --to keep` keeps it.

## 0.6.0 (2026-10-27)

- **Find hidden rules.** A new button in the panel finds rules that sit outside CC Rules, in Claude Code's instruction
  files (`CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/rules/`), "feedback" notes in Claude's memory, Markdown
  files with "rules" in the name, and files left over from Chat Rules. It looks in your user folder, the chat's folder
  and the folders above it, and folders up to three levels below it.
- Each rule found can be **moved** into CC Rules (global, this chat's project, any other sidebar group, or this chat,
  picked from a **Move to** list), **removed** from its file, or **kept** where it is and no longer listed. **Keep all**
  does that for a whole file.
- Every move and removal backs up the file first, in `~/.claude/cc-rules/.backups/`, and **Undo last change** puts it
  back, including taking a moved rule back out of CC Rules.
- In mixed files such as `CLAUDE.md`, only short lines that read as instructions count, and not under headings for
  knowledge such as "Things learned the hard way", so notes on how a program works stay out of the list.
- The same from the command line or by asking Claude: `scan`, `adopt <ID> --to <target>`, `clean`, `keep`, `undo`.

## 0.5.0 (2026-10-27)

**Renamed from Chat Rules to CC Rules.** Earlier entries below use the old name.

| | Before | Now |
| --- | --- | --- |
| Plugin ID and install | `chat-rules@chat-rules` | `cc-rules@cc-rules` |
| Commands | `/rules`, `/chat-rules:rules`, `/rules-panel` | `/rules`, `/cc-rules:rules`, `/rules-panel` |
| Project folder | `My Programs\ChatRules` | `My Programs\CCRules` |
| Rules home | `~/.claude/chat-rules/` | `~/.claude/cc-rules/` |
| Folder project rules | `<folder>/.claude/chat-rules/PROJECT.md` | `<folder>/.claude/cc-rules/PROJECT.md` |
| Overrides | `CHAT_RULES_HOME`, `CHAT_RULES_DESKTOP_DIR` | `CC_RULES_HOME`, `CC_RULES_DESKTOP_DIR` |
| Release zip | `ChatRules_v<version>.zip` | `CCRules_v<version>.zip` |

Nothing else changed. A plugin ID is part of an install, so the old install has to be removed and the new one added
(see Install in the README); the Node.js path option is set again at install.

## 0.4.0 (2026-10-27)

Claude Code only, brought up to date with Claude Code 2.1.308 and the current desktop app.

- **Fixed: sidebar-group projects had stopped working.** In October 2026 the desktop app moved its data from
  `%APPDATA%\Claude` to `%LOCALAPPDATA%\Claude-Data\claude_<package>`, so every chat quietly fell back to its
  folder's rules. Chat Rules now finds the data folder from the Claude Code the app started, then searches the known
  locations, and goes straight to the chat's own record when the app names it.
- **A lost desktop app now says so.** Inside the app, a chat whose record can't be found gets a warning at chat start
  instead of a silent fallback to folder rules.
- Panel: on Claude Code 2.1.299 and later, headings use `size="heading"` and `weight="semibold"` (2.1.299 deprecated
  `bold`), spacing uses the named steps each surface sizes natively, and error text uses the theme's `error` colour. An
  older Claude Code refuses those props, so there the panel keeps the old styles; it checks the version at chat start.
- Panel: no longer refreshes after a subagent's turn (Claude Code 2.1.290 started reporting those), only the main
  conversation's.
- Panel: closing it always goes ahead even if remembering the close fails, as the 2.1.308 validator asks of hooks
  that can block.
- README states plainly that Chat Rules is for Claude Code, and points Chat and Cowork users at Instructions for Claude.
- Removed old code: the `--scope` option (use `--level`), and module exports nothing used.
- The author and licence now name Griffith Software, matching the other projects.

## 0.3.0 (2026-10-03)

- **Chat Rules panel**: a pane in the Code tab that shows this chat's rules at all three levels, with
  Pause/Resume buttons and links to open each file. It keeps itself up to date (hand edits, renames, group
  moves, Claude's changes), opens by itself when a chat starts, and stays closed in later chats once you
  close it by hand. `/rules-panel` opens it again. Built as a Claude Code mod (`hooks/panel.tsx`), which is
  an early-access feature.
- A status line entry shows how many rules are active.
- `rules.js list --json` prints the rules as data, and `--no-snapshot` leaves the record of what Claude was
  last told alone, so a change made in the panel still reaches Claude at the next message.
- Panel tests run with Claude Code's own plugin test runner: `claude plugin test .`

## 0.2.0 (2026-10-03)

- Three levels of rules, highest first: **global** (every chat), **project** (every chat in a project) and
  **chat** (one chat). If rules conflict, the higher level wins.
- A chat's project is the desktop app sidebar group it's filed under; a chat in no group uses its folder.
  Filing a chat under another group switches its project rules.
- Global, group-project and chat files now live together in `~/.claude/chat-rules/`, named after the group
  or chat. Each file carries a "Linked to ..." line with the group's or chat's ID, so when you rename a chat
  or group, its file is renamed to match and the rules stay with it. Folder projects keep
  `<folder>/.claude/chat-rules/PROJECT.md`.
- New check before each message (UserPromptSubmit hook): picks up hand edits, renames and group moves
  mid-chat, tells you what changed, and stays silent otherwise.
- Rule IDs come from one counter for every level and project, so an ID is never reused.
- A project or chat file you make by hand, named to match, is adopted and linked.
- `--scope` is now `--level` (global, project, chat); `--scope` still works.
- 0.1.0 chat files in `<folder>/.claude/chat-rules/chats/` aren't read any more (0.1.0 was never installed).

## 0.1.0 (2026-10-03)

First release.

- Rules live in Markdown checklists you can open and edit: `.claude/chat-rules/PROJECT.md` for every
  chat in the project, `.claude/chat-rules/chats/<session-id>.md` for one chat.
- SessionStart hook loads the active rules into every chat (start, resume, `/clear`, after compaction)
  and shows you a short list of them.
- `/rules` lists, adds, edits, removes, pauses, resumes and moves rules, and echoes each change.
- Hand-added rules get IDs automatically; repeated IDs are renumbered; stray bullets are flagged.
- Claude checks a new rule against the active ones and asks which wins if they conflict.
- "Node.js path" plugin option for machines without `node` on PATH.
- No dependencies; tests use Node's built-in runner; `tools/package.js` builds the release zip.
