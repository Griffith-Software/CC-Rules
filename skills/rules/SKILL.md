---
name: rules
description: Show and change the user's visible chat rules (CC Rules plugin; typed on its own, /rules opens the CC Rules panel), at three levels - global (every chat), project (every chat in this project) and this chat. Use when the user says "make a rule for this chat", "make a rule for this project" or "make a rule for every chat" / "add a global rule", asks to add, edit, remove, pause, resume or move a rule, refers to a rule by ID such as R3, asks what rules are active, asks to reload the rules, or asks to find hidden, stray or leftover rules (in CLAUDE.md files, Claude's memory or rules files) and move them into CC Rules or clean them out.
argument-hint: "[list | add <rule> | add --level project|global <rule> | edit R3 <text> | remove R3 | pause R3 | resume R3 | move R3 --to global|project|chat]"
---

# CC Rules

The user's rules live in Markdown files they can open and edit by hand, at three levels. Higher levels win
any conflict:

| Level | Applies to | File |
| --- | --- | --- |
| global (highest) | every chat | `~/.claude/cc-rules/GLOBAL.md` |
| project | every chat in this project | `~/.claude/cc-rules/projects/<group name>.md`, or `<folder>/.claude/cc-rules/PROJECT.md` |
| chat (lowest) | this chat only | `~/.claude/cc-rules/chats/<chat name>.md` |

A chat's **project** is the desktop app sidebar group it's filed under. A chat in no group uses the folder it
runs in. Project and chat files are linked to the group's or chat's ID, so when the user renames the chat or the
group, the file is renamed to match and the rules stay. Filing the chat under another group switches its project
rules. This chat's session ID is `${CLAUDE_SESSION_ID}`.

Each rule is one checklist line with an ID that's never reused, for example `- [x] R3: Always answer in plain English`.
`[x]` means active and `[ ]` means paused. A rule keeps its ID when it moves between levels.

## Running the tool

Make every change with the CC Rules tool. Don't edit the rule files with Write or Edit. The tool re-reads
every file from disk on every run, so it sees the user's hand edits. It also gives hand-added rules an ID, keeps
file names in step with renamed groups and chats, and changes only the line it needs to.

The "CC Rules" context gives the full command line for this chat. It looks like this:

```
"<node>" "<plugin>/scripts/rules.js" --root "<folder>" --session <session-id> <command> ...
```

If that context is missing (for example because the hook couldn't find Node), use
`node "${CLAUDE_PLUGIN_ROOT}/scripts/rules.js" --root "${CLAUDE_PROJECT_DIR}" --session ${CLAUDE_SESSION_ID}`.
If `node` isn't found, tell the user to set the plugin's Node.js path (see the plugin README) and stop.

Pass rule text on stdin with a quoted heredoc, so quotes, `$` and backticks arrive unchanged:

```bash
<command line> add --level chat --stdin <<'RULE'
Always answer in plain English
RULE
```

In PowerShell, start the command line with `& ` and pass the text as `--text 'Always answer in plain English'`
(double any `'` inside the text).

## Commands

| The user says | Command |
| --- | --- |
| `/rules list`, "show my rules", "what rules are active?" | `list` |
| "make a rule for this chat: X", `/rules add X` | `add --level chat --stdin` (this chat is the default) |
| "make a rule for this project: X", "...for this group" | `add --level project --stdin` |
| "make a rule for every chat: X", "add a global rule", "...everywhere" | `add --level global --stdin` |
| "change R3 to X" | `edit R3 --stdin` |
| "delete R3", "remove R3" | `remove R3` |
| "pause R3", "turn off R3" | `pause R3` |
| "resume R3", "turn R3 back on" | `resume R3` |
| "make R3 global", "make R3 a project rule", "move R3 to this chat" | `move R3 --to global`, `--to project` or `--to chat` |
| "reload the rules", "I edited the file" | `list` |
| "find hidden rules", "tidy up my rules", "what rules are in my CLAUDE.md files?" | `scan`, then see Finding hidden rules |

`pause`, `resume`, `remove` and `move` accept several IDs at once. Use `add --paused` to add a rule switched off.
If the chat has no name yet when you create its file, add `--title "<3 to 6 words on what this chat is about>"`.
The file is renamed to the chat's real name once it has one.

## Steps for every change

1. **Re-read first.** Run `list`. Its output shows the files as they are now, including hand edits. It
   replaces any rule list you were given earlier in the chat.
2. **Check for conflicts.** For `add`, `edit`, `resume` and `move`, compare the new or changed rule with
   every *active* rule at all three levels. If it contradicts one (for example, the new rule "Reply in French"
   against R1 "Always answer in plain English"), make no change yet. Tell the user which rule it clashes
   with, quote both with their levels, and ask which wins:
   - keep the existing rule and drop the new one
   - use the new rule and pause the existing one
   - use the new rule and remove the existing one

   Mention the level order when it matters. If the existing rule is at a higher level, the new rule wouldn't
   take effect while the existing one is active. If the existing rule is global or project-level, pausing or
   removing it changes it for other chats too. Then do what they choose. A rule that only adds detail to
   another (for example "use metric units" plus "give imperial too for recipes") isn't a conflict. If you're
   unsure, ask.
3. **Make the change** with the command from the table.
4. **Echo it back.** Show the user the tool's confirmation line exactly as printed, for example
   `Added R4 to this chat: Always answer in plain English`. Pass on any `Note:` lines too, because they
   report renamed files, hand-added rules that got IDs, and lines that aren't rules.
5. **Follow the new rules** from your next action on: newly active rules apply at once, and paused or
   removed rules stop applying.

Typed on its own, `/rules` opens the CC Rules panel beside the chat and doesn't reach you. If it reaches you with no
arguments anyway (the panel isn't running, or you ran it yourself), run `list` and show the table as printed. If a
command fails, show the error and suggest the fix, for example `list` to see the valid IDs.

## Finding hidden rules

Rules can also sit outside CC Rules, where the panel can't show them: in `CLAUDE.md`, `CLAUDE.local.md` and
`AGENTS.md` files, `.claude/rules/`, Claude's memory ("feedback" notes), Markdown files with "rules" in the name,
and old Chat Rules files. When the user asks to find or tidy up those rules:

1. Run `scan`. Each rule found has an ID like `H1a2b3c`, its file and line, and the heading it sits under.
2. Show them grouped by file and ask what to do with each, or with a group: move it into CC Rules, remove it from its
   file, or keep it where it is. Under a rule, `suggested:` names the project (`group:<id>`) and chat (`session:<id>`)
   it seems written for, worked out from its heading, folder or memory note, and `global` for one under a "Global"
   heading. Offer those first. In a `CLAUDE.md` file, say when a line looks like a note on how the program works rather
   than a rule: those usually belong where they are. Rules CC Rules already has aren't listed.
3. Before `adopt`, do the same conflict check as for `add`.
4. Run `adopt <ID> --to global|project|chat|group:<name>|session:<id>`, `clean <ID>` or `keep <ID>...`, and echo each
   line it prints. Every adopt and clean backs up the file first, and `undo` puts back the latest one.

The panel's **Find hidden rules** button does the same with buttons.

## The user's request

$ARGUMENTS
