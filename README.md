# claude-bookmarks

`cbm` bookmarks Claude Code sessions by name, finds them again by name, tag, note or summary, and resumes them with `claude --resume <uuid>` in the session's project directory. Bookmarks live in their own JSON file; Claude Code transcripts are only read, never written. Everything runs offline.

## Install

Requires Node 26 or newer (it runs the TypeScript sources directly).

```sh
git clone https://github.com/Revaz-Goguadze/claude-bookmarks.git
cd claude-bookmarks
npm i --omit=optional
npm link
```

`npm link` puts `cbm` on your PATH.

## Usage

```sh
cbm sessions [query] [--limit N] [--json]         # recent sessions across all projects (default 20)
cbm add <uuid> [--name N] [--tag T]... [--note X] # bookmark a session
cbm list [query] [--tag T]... [--json]            # list and search bookmarks
cbm open <selector> [--fork] [--print-command] [--allow-missing-cwd]
cbm edit <selector> [--name N] [--add-tag T]... [--rm-tag T]... [--note X]
cbm remove <selector>                             # deletes the bookmark, never the session
```

A selector is a bookmark name in any case, a full session uuid, or a uuid prefix of at least 8 characters that matches one bookmark.

Typical flow:

```sh
cbm sessions refresh
cbm add 3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f --name "Auth fix" --tag auth --note "check refresh"
cbm list auth
cbm open "auth fix"
```

`cbm add` without `--name` uses the session's title or summary, or `session <id prefix>` when that is a slash command. Tags are lowercased and a leading `#` is dropped. `cbm open --fork` resumes into a new forked session, and `cbm open --print-command` prints the `cd ... && claude --resume ...` line instead of running it.

When a session file is deleted, its bookmark stays in the store and shows as `missing` in `cbm list`; `cbm open` then exits 4. When the project directory is gone, `cbm open` exits 3 unless you pass `--allow-missing-cwd`, which opens the session from the current directory.

`cbm list --json` and `cbm sessions --json` print one JSON line: `{"ok":true,"data":{...}}` or `{"ok":false,"error":{"code":"...","message":"..."}}`.

Exit codes: 0 ok, 1 corrupt store or internal error, 2 usage or invalid input or ambiguous selector, 3 project directory missing, 4 session missing, 5 no such bookmark, 6 duplicate session or name, 127 claude not found. A successful `cbm open` exits with Claude's own exit code.

## Environment

- `CBM_STORE`: path of the bookmark store. Defaults to `$CLAUDE_CONFIG_DIR/bookmarks.json`, else `~/.claude/bookmarks.json`.
- `CBM_CLAUDE_BIN`: the Claude Code binary `cbm open` runs. Defaults to `claude` on PATH.
- `CLAUDE_CONFIG_DIR`: where Claude Code keeps its sessions; also read when listing sessions.

## Claude Code plugin

The `plugin/` directory is a Claude Code plugin with two slash commands that call `cbm`, so install the CLI first.

Install it permanently from this repo's marketplace:

```sh
claude plugin marketplace add Revaz-Goguadze/claude-bookmarks
claude plugin install session-bookmarks@claude-bookmarks
```

Or load it for one session only with `claude --plugin-dir ./plugin`. Installed plugin commands may show up namespaced as `/session-bookmarks:bookmark` and `/session-bookmarks:bookmarks`.

- `/bookmark Auth fix #auth #urgent` bookmarks the current session. Words starting with `#` become tags, the rest is the name.
- `/bookmarks [query]` shows `cbm list` output.

## Development

```sh
npm test
```

## License

MIT
