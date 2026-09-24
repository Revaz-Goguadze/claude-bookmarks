# Claude Code Session Bookmarks

## Status

- **Document:** Product and implementation specification
- **Version:** 1.0
- **Date:** 2026-09-19
- **Repository state:** The repository is currently empty. It contains no package metadata, source files, tests, or existing architecture.
- **Implementation status:** Specification only. Do not implement in this phase.

## 1. Problem

Claude Code persists local conversations as session files and exposes them through the built-in `/resume` picker and `claude --resume`. The built-in picker is useful for occasional continuation, but it is not a durable personal index. A user who has many sessions must search by title, project, or recent activity and may still need to open sessions one by one to identify the correct conversation.

Users need to explicitly bookmark important sessions, give them stable human-readable names, and reopen them directly. Bookmarks must remain useful when there are many sessions, multiple projects, renamed sessions, or stale and deleted session files.

### Success statement

A user can bookmark a session once, find it later by a short name, tag, project, or note, and launch Claude Code directly into that session without inspecting unrelated sessions through `/resume`.

## 2. Product decision

Build a local, terminal-native companion named `claude-bookmarks`.

The companion has two layers:

1. **Core CLI:** Uses the supported Agent SDK session catalog APIs when available, stores bookmark metadata in a separate file, lists and searches bookmarks, and launches `claude --resume <session-id>`. A read-only JSONL adapter is a compatibility fallback only.
2. **Claude Code integration:** Provides optional `/bookmark` and `/bookmarks` commands or an equivalent plugin wrapper after the supported hook and command behavior is verified against the installed Claude Code version.

The core CLI is authoritative. The integration must never be required for listing or opening bookmarks. A sidecar bookmark name is independent from Claude Code's native session name and is not automatically visible in `/resume`; optional synchronization uses the supported SDK mutators. The tool must not append raw `custom-title` or `tag` records.

### Why a companion index

Claude Code exposes `--resume <session-id>`, `--name`, and an interactive resume picker, but it does not expose a documented extension point for inserting third-party records into the built-in `/resume` list. The feature therefore maintains a sidecar index and delegates actual resumption to the official CLI.

The implementation must not rewrite, append to, or delete Claude Code session JSONL files.

## 3. Goals

### MVP goals

- Discover local, persisted Claude Code sessions across all projects under the configured Claude state directory.
- Create a bookmark for a specific session ID.
- Assign a required stable bookmark name and optional note and tags.
- List bookmarks in a compact, sortable terminal view.
- Search bookmarks without opening sessions.
- Open a bookmark directly in Claude Code.
- Edit, remove, and repair bookmarks.
- Show whether a bookmark currently resolves to an existing session file.
- Preserve bookmarks when their session is temporarily unavailable or deleted.
- Work with concurrent Claude Code sessions; the compatibility fallback must tolerate a partially written JSONL file.
- Keep conversation content local and avoid sending session data to any network service.

### Post-MVP goals

- Bookmark the current interactive session from inside Claude Code without manually copying its ID.
- Optional folder or collection support.
- Optional `fzf`-style filtering when an external selector is installed.
- Import and export bookmarks for backup.
- Opt-in synchronization of a bookmark name through Agent SDK `rename_session` and one native tag through `tag_session`; the sidecar remains authoritative for pins, notes, and multiple tags.
- Read-only bookmark metadata in a Claude Code status or prompt integration, if a supported extension point exists.

## 4. Non-goals

- Replacing or modifying the built-in `/resume` picker.
- Reimplementing Claude Code's conversation storage or resume logic.
- Editing conversation transcripts or changing their retention behavior.
- Cloud synchronization, a web dashboard, or a remote database.
- Searching the semantic content of every transcript in the MVP.
- Automatically bookmarking every session.
- Inferring a user's intent from conversation content with an LLM.
- Deleting Claude Code sessions as part of bookmark removal.
- Supporting cloud, teleport, or remote sessions in the MVP unless the official CLI provides a stable local session identifier and resume contract for them.

## 5. Users and primary flows

### Flow A: Bookmark a known session

```text
$ claude-bookmarks add 3f5... --name "Fix import job" --tag parts --tag urgent
Bookmark created: Fix import job
Session: 3f5...
```

The session ID is the canonical identity. The bookmark name is user metadata and may be changed without changing the session.

### Flow B: Discover and bookmark an existing session

```text
$ claude-bookmarks sessions --project ~/work/my-app
...
3f5...  Fix import job      2026-09-18  ~/work/my-app
7a1...   API investigation      2026-09-17  ~/work/my-app

$ claude-bookmarks add 3f5... --name "Fix import job"
```

### Flow C: Find and open a bookmark

```text
$ claude-bookmarks open "import"
Opening "Fix import job" in ~/work/my-app
```

The program changes to the session's last known project directory, verifies that the directory still exists, and executes:

```text
claude --resume 3f5...
```

The default behavior resumes the original session ID. An explicit `--fork` passes `--fork-session` so the original remains unchanged.

### Flow D: Browse bookmarks

```text
$ claude-bookmarks list
★ Fix import job   [parts, urgent]   2 days ago   ready
  Landing page CRO     [vgra]           5 days ago   ready
  Old deployment       [ops]            3 weeks ago missing

$ claude-bookmarks open
```

With no selector, `open` presents a numbered, keyboard-friendly or line-oriented picker. The picker must work in a plain TTY without requiring `fzf`.

### Flow E: Maintain stale bookmarks

```text
$ claude-bookmarks doctor
3 bookmarks checked
2 ready
1 missing

$ claude-bookmarks remove "Old deployment"
```

Removing a bookmark removes only sidecar metadata. It must never remove the corresponding session file.

## 6. User-facing command contract

The executable name is `claude-bookmarks`. A short alias may be added only if it does not conflict with the package or shell environment. The examples below define the required behavior, not a fixed argument parser library.

### `list`

```text
claude-bookmarks list [options]
```

Options:

- `--tag <tag>`: Include only bookmarks with the tag.
- `--project <path>`: Include only bookmarks whose canonical project path matches the path or is below it.
- `--ready-only`: Include only bookmarks with derived status `ready`. Missing, archived, collision, invalid, and sidechain bookmarks are excluded. Without this option, stale statuses remain visible so they are not silently lost.
- `--sort <updated|created|name|last-used|project>`: Default `updated`.
- `--json`: Emit the stable machine-readable schema described below.
- `--no-color`: Disable ANSI styling.

Output requirements:

- Every row includes bookmark name, useful identity hint, last known project, last session activity, and status.
- Names and notes are escaped so terminal control sequences from session metadata cannot execute.
- Output remains usable when paths or titles are long. The renderer truncates with a visible ellipsis and keeps the selector usable.
- Empty state tells the user how to add the first bookmark.

### `open [selector]`

Selectors are resolved in this order:

1. Exact bookmark ID.
2. Exact bookmark name, case-insensitive.
3. Exact session ID.
4. Unique case-insensitive prefix of bookmark name or ID.
5. Fuzzy match over name, tags, note, project path, session title, and session ID.
6. Interactive picker if no selector was supplied or multiple matches remain.

Options:

- `--fork`: Pass `--fork-session` to Claude Code.
- `--cwd <path>`: Override the stored project directory for this launch.
- `--allow-missing-cwd`: Explicitly allow launching from the current directory when the stored project directory is unavailable.
- `--dry-run`: Print the resolved command and directory without launching it.
- `--json`: Return the resolved bookmark and command instead of launching.

Ambiguous non-interactive input must fail with exit code `2` and print the candidate names. It must not choose arbitrarily.

### `add <session-id>`

```text
claude-bookmarks add <session-id> --name <name> [options]
```

Options:

- `--name <name>`: Required for explicit CLI adds. One to 120 Unicode characters after trimming.
- `--tag <tag>`: Repeatable. Tags are case-insensitive for matching and stored in normalized form.
- `--note <text>`: Optional note, maximum 500 Unicode characters.
- `--project <path>`: Optional override only when session discovery cannot resolve a path.
- `--json`: Emit the created bookmark.

Rules:

- A session ID can have at most one active bookmark in the MVP.
- Adding an already bookmarked session fails clearly unless `--update` is supplied.
- `--update` changes supplied fields and preserves omitted fields.
- The command validates that the ID is a valid UUID before touching the store.
- By default, the command warns when the session cannot be found but permits creation as a missing bookmark. `--require-existing` converts that warning into an error.

### `sessions`

```text
claude-bookmarks sessions [options]
```

Purpose: show discoverable sessions that are not necessarily bookmarked.

Options:

- `--project <path>`: Filter by project.
- `--query <text>`: Search derived metadata only. Prompt-content search is post-MVP and opt-in.
- `--include-bookmarked`: Include already bookmarked sessions.
- `--include-sidechains`: Include sessions marked as sidechains or subagents.
- `--limit <n>`: Default 100, maximum 1000.
- `--json`: Emit session records.

This command is a discovery aid only. It must not require opening each session to inspect it.

### `edit <selector>`

```text
claude-bookmarks edit <selector> [--name <name>] [--note <text>] [--tag <tag>] [--remove-tag <tag>]
```

- At least one mutable field is required.
- Tags are additive with `--tag` and subtractive with `--remove-tag`.
- `--clear-note` explicitly removes a note.
- Editing a bookmark never changes the Claude Code session.

### `remove <selector>`

```text
claude-bookmarks remove <selector> [--yes]
```

- Interactive TTY mode asks for confirmation.
- `--yes` is required in non-interactive mode.
- The command removes only the bookmark record.

### `doctor`

```text
claude-bookmarks doctor [--repair] [--json]
```

Checks:

- Bookmark store syntax and schema version.
- Duplicate session IDs.
- Invalid UUIDs.
- Unresolvable session IDs.
- Missing project directories.
- Invalid or unrecognized tag/name values.
- Session metadata that has changed since the bookmark was created.

`--repair` may normalize metadata and refresh derived fields. It must not remove bookmarks or session files automatically. Any destructive cleanup remains an explicit `remove` operation.

### `config`

```text
claude-bookmarks config path
claude-bookmarks config set claude-dir <path>
claude-bookmarks config set store <path>
```

The MVP should support environment overrides even if a full config command is deferred:

- `CLAUDE_CONFIG_DIR`: Claude state directory override.
- `CLAUDE_BOOKMARKS_STORE`: bookmark store override.
- `CLAUDE_BOOKMARKS_NO_COLOR=1`: disable color.

`CLAUDE_CONFIG_DIR` is the documented Claude Code state-directory override, but the implementation must still verify the effective path in a fixture. The bookmark tool must not silently use a different root than Claude Code.

## 7. Data model

### 7.1 Bookmark store

Default path:

```text
~/.claude/bookmarks.json
```

The path is configurable. The store is private user data and must be created with permissions no broader than `0600` on POSIX systems. Parent directories must be created with `0700` when the tool creates them.

Schema version 1:

```json
{
  "version": 1,
  "bookmarks": [
    {
      "id": "bm_01J...",
      "sessionId": "3f5c1d80-....",
      "name": "Fix import job",
      "note": "Continue after supplier mapping review",
      "tags": ["parts", "urgent"],
      "createdAt": "2026-09-19T12:00:00.000Z",
      "updatedAt": "2026-09-19T12:02:00.000Z",
      "lastOpenedAt": null,
      "snapshot": {
        "title": "Fix import job",
        "cwd": "~/work/my-app",
        "projectKey": "-home-user-work-my-app",
        "sessionMtime": "2026-09-18T16:31:22.000Z",
        "lastActivityAt": "2026-09-18T16:30:11.000Z"
      }
    }
  ]
}
```

Requirements:

- `id` is an opaque bookmark record ID and is not the Claude session ID.
- `sessionId` is the canonical foreign key to Claude Code.
- `name` is user-controlled and is the primary display label.
- `snapshot` contains derived cache data only. It may be refreshed or discarded without losing user metadata.
- Derived status is one of `ready`, `missing`, `archived`, `collision`, `invalid`, or `sidechain`; it is computed from the discovery adapter and is not a user-controlled archive flag.
- Timestamps are UTC ISO 8601 strings.
- Unknown top-level and record fields must be preserved when possible, or rejected with a clear version error if preservation is unsafe.
- Future schema migrations must write a new file atomically and retain a timestamped backup before replacing the old store.

### 7.2 Atomic persistence

Every write follows this sequence:

1. Read and validate the current store.
2. Acquire a lock using an adjacent lock file or an equivalent OS-safe mechanism.
3. Re-read after acquiring the lock.
4. Apply the mutation.
5. Write a temporary file in the same directory with mode `0600`.
6. Flush and close it.
7. Rename it over the target store atomically.
8. Release the lock.

A stale lock must produce a diagnostic with the lock age and owner information. The implementation may offer an explicit `--break-lock` only after verifying the lock is stale. It must not silently overwrite another process's update.

## 8. Session discovery contract

### Discovery adapters

The primary discovery adapter uses the supported Agent SDK session catalog APIs:

- `list_sessions(directory, limit, offset, include_worktrees)` for catalog listing.
- `get_session_info(session_id, directory)` for refresh and status.
- `rename_session(session_id, title, directory)` only for optional native title synchronization.
- `tag_session(session_id, tag, directory)` only for optional synchronization of one native tag.

The adapter maps SDK fields such as `session_id`, `summary`, `last_modified`, `file_size`, `custom_title`, `git_branch`, `cwd`, `tag`, and `created_at` into the internal session model. The SDK is the source of truth for identity and mutable session metadata. The implementation must pin and document the SDK version and must not import Claude Code's private internal packages.

For an all-projects operation, the adapter must first call `list_sessions(directory=None, include_worktrees=true)` and follow SDK pagination until the requested limit is reached. If the selected SDK only supports directory-scoped listing, the implementation must enumerate configured project roots explicitly and make the scope visible in output; it must not guess paths by reversing the encoded directory name. A missing global-list capability is an unsupported-adapter result and may use the read-only fallback. A timeout, permission error, malformed SDK response, or other transient/runtime error must fail the command with diagnostics and must not silently fall back.

If the SDK is unavailable, the CLI may use a read-only compatibility adapter over the observed local layout:

```text
~/.claude/projects/<encoded-project-path>/<session-id>.jsonl
```

A probe on the target machine on 2026-09-19 found Claude Code `2.1.278`. The local tree also contains older records from other Claude Code versions, so the fallback parser must be fixture-tested against more than one observed version before the contract is frozen. The fallback is allowed to read metadata, but it must never rewrite or append JSONL records.

For the fallback only, the encoded directory name must not be decoded by simple hyphen replacement. The canonical path is obtained from session records when possible. If no path can be established, the project key remains an opaque grouping key.

**Archive scope:** MVP does not treat archived artifacts as ready or resumable sessions. If the SDK or fallback adapter positively identifies an archived artifact, expose derived status `archived`, keep it distinct from `missing`, and refuse to open it unless a future archive adapter is enabled. Unknown archive directories are ignored rather than reported as ordinary missing sessions. The bookmark store has no user-controlled archive state. Migration backups are separate files named `bookmarks.json.bak.<UTC-timestamp>`, created with private permissions. Keep the three most recent backups and remove older backup files only during an explicit migration or repair operation. They are never indexed as bookmarks.

### Fallback JSONL parsing

These rules apply only when the SDK adapter is unavailable. For every candidate JSONL file:

- Derive the session ID from the filename only when it is a valid UUID.
- Parse line by line without loading the complete transcript into memory.
- Ignore a single incomplete final line caused by an active writer.
- Record a warning for malformed non-final lines and continue where safe.
- Read only metadata needed for indexing by default.
- Never print prompt or tool content unless the user explicitly requests a field that contains it.
- Treat all session fields as untrusted text for terminal rendering.
- When a record contains `sessionId`, require it to match the filename UUID. A mismatch makes the file invalid for automatic opening and produces a doctor diagnostic.

A UUID found in more than one session file is a collision in the MVP. The scanner must expose every candidate path and refuse to launch that UUID until the user resolves it; it must never select a winner by mtime. Automatic grouping of continuation or relocation files is deferred to a future adapter with an explicit proof predicate.

### Derived metadata

The discovery adapter derives the same internal model from SDK fields or, only in fallback mode, from JSONL metadata:

- `sessionId`.
- Canonical or last known `cwd`.
- Project key and display path.
- File existence, size, and modification time.
- Last activity timestamp.
- Whether the session is a sidechain or hidden from the native picker.
- Optional native tag, without replacing the bookmark's multi-tag set.
- A short title using this priority:
  1. Latest valid user `custom-title`.
  2. Latest valid `ai-title`.
  3. SDK `summary`.
  4. A safely truncated prompt fallback only when prompt indexing is explicitly enabled.
  5. The session ID.
- Default display names such as `<cwd-basename>-<suffix>` are not treated as titles or resume handles.
- A prompt index is not persisted or searched in the MVP.

The scanner should use the latest event for mutable metadata, not the first event. Repeated continuation or relocation records within one file must be handled deterministically. A file path move is discovered on a later scan as the same session only when its verified UUID remains the same and the old path is no longer present; two simultaneously present files with the same UUID remain a collision.

### Exclusions

Default indexing excludes:

- Sidechain or subagent sessions unless `--include-sidechains` is supplied.
- Files that are not valid session UUID files in fallback mode.
- Session records explicitly marked as non-resumable.
- Cloud or teleport records unless supported by an implementation-specific adapter.

Sessions hidden from the native picker because they came from `-p`, the Agent SDK, or an initial `/loop` prompt remain eligible when the SDK reports them as resumable. They must be visibly labeled `hiddenFromPicker` so the user understands why `/resume` may not show them. Sidechains must be visibly labeled and must not be confused with resumable primary sessions.

### Refresh strategy

MVP may refresh the SDK catalog on each command. It must be correct before it is optimized.

The discovery layer must:

- Cache SDK session metadata by session ID and the SDK's `last_modified` value.
- Invalidate a cache entry when the SDK reports a newer `last_modified` or a changed file size.
- Handle a deleted session between discovery and open as a normal stale-bookmark error.
- Avoid loading full transcripts for list/open operations.
- Apply the file path, size, mtime, incomplete-line, and malformed-line rules above only in fallback JSONL mode.

Target for a cold catalog refresh: complete within 2 seconds for 2,000 session records on a normal developer laptop. If the target cannot be met, the command must still show progress or a clear scanning state instead of appearing frozen.

## 9. Opening and resume behavior

The launcher is a thin adapter around the installed `claude` executable.

### Required launch algorithm

1. Resolve the selector to exactly one bookmark.
2. Refresh the session snapshot for that bookmark.
3. Confirm the session ID is a valid UUID.
4. Resolve the working directory using, in order:
   - explicit `--cwd`;
   - current valid session `cwd`;
   - stored snapshot `cwd`.
5. An explicit `--cwd` must already exist as a directory. Canonicalize it with the platform real-path operation, reject a file or broken path, and show a warning when it differs from the session's stored cwd because project settings and tool context may differ.
6. If the stored project directory is unavailable, stop with exit code `3` by default. Because Claude Code `2.1.278` can resolve a unique UUID across project directories, `--allow-missing-cwd` may explicitly select the canonical current directory, with the same visible warning.
7. Execute `claude --resume <sessionId>` from the selected directory.
8. Add `--fork-session` only when `--fork` was requested.
9. Spawn the child with inherited stdin, stdout, and stderr. When the operating system confirms the child was spawned, update `lastOpenedAt` in a best-effort locked store write.

Use an inherited-stdio child process rather than `exec`, so the launcher can record the successful spawn and still forward the child's exit code and termination signal. If the metadata write fails after launch, print a warning but do not terminate or restart Claude Code. Do not shell-concatenate user-controlled strings. Pass arguments as an array through the process API.

### CLI discovery

Resolve `claude` from:

1. `CLAUDE_BOOKMARKS_CLAUDE_BIN`, if set.
2. The current `PATH`.
3. A configured absolute path.

Before launching, `--dry-run` must show the exact executable, argument vector, and working directory. It must never include secrets or transcript content.

### Failure behavior

- Missing executable: exit `127`, explain how to configure the path.
- Missing session record: exit `3`, keep the bookmark and mark it `missing`.
- Archived session: exit `3`, keep the bookmark and mark it `archived`; do not treat an archive artifact as a live resume target.
- Missing project directory: exit `3` by default, suggesting `open --cwd <existing-path>`, `--allow-missing-cwd`, or `edit`/`doctor`; launch from the current directory only with explicit `--allow-missing-cwd` and a warning.
- Ambiguous selector: exit `2`, list candidates.
- Claude Code exits: return the same exit code when available.
- Launch permission or OS error: exit `1` with the original error and the resolved target.

## 10. Search and ranking

MVP search is deterministic and local.

Search fields, in descending weight:

1. Exact bookmark name.
2. Bookmark name prefix.
3. Tags.
4. Note.
5. Session title snapshot.
6. Project basename and path.
7. Session ID.

Prompt-content search is post-MVP. If it is later enabled, it must use an explicit opt-in index with a documented storage and deletion lifecycle.

Ranking must be stable. Ties are broken by most recently active session, then bookmark name, then bookmark ID. The implementation must document the normalization rules for case, Unicode, and punctuation.

The tool must never send search terms or session contents to an LLM, analytics service, or remote API.

## 11. Claude Code integration

### MVP integration boundary

Integration is optional and must not be allowed to block the core CLI. The implementation starts by testing these supported mechanisms against the installed Claude Code release:

- Custom slash commands or skills that can invoke the local CLI through Bash.
- Hook payloads that provide the current `session_id`, `cwd`, and relevant lifecycle event.
- The `--name` display-name facility, which may improve derived titles but is not the bookmark store.

The implementation must record the exact tested Claude Code version and the observed payload shape in an integration test fixture. It must not rely on undocumented environment variables without a fixture and a version guard.

### Proposed commands

The default integration is browsing-only. Current-session creation is opt-in and must use an exact trigger guard:

- The `UserPromptSubmit` hook matcher is `^/bookmark(?:\\s|$)` or the equivalent exact command matcher supported by the target release.
- The hook parses JSON stdin and requires a valid `session_id`, `transcript_path`, and `cwd`. It invokes the local CLI with an argument array, never shell interpolation, and passes only the explicit bookmark name or note from the matched command.
- Any payload that does not match the command, lacks a valid session ID, or has an unexpected schema is ignored with no bookmark mutation.
- `/bookmark`: Create or update a bookmark for the current session. If no name is supplied, prompt for one. If a name is supplied, preserve it exactly after validation.
- `/bookmarks`: List or search bookmarks and print commands for opening them. An interactive command should be offered only when the terminal remains attached and the command can safely replace the current process.
- Native picker visibility may optionally be improved with the supported `sessionTitle` hook output or SDK `rename_session`, but that overlay is not the bookmark store.

If current-session identification is not reliable, install only `/bookmarks` for browsing and require `claude-bookmarks add <session-id>` for creation. Do not guess the current session based solely on project path or most recent mtime, because multiple sessions may share a directory.

### Integration safety rules

- Integration commands call the local CLI and do not edit Claude's session JSONL.
- A command must not automatically run `claude --resume` from inside the current Claude process unless process replacement is proven safe. The default integration should print the exact external command or ask the user to run it.
- Plugin installation must be opt-in and documented separately from the core CLI.
- Version incompatibility disables only the integration layer and leaves the core CLI usable.

## 12. Privacy and security

Session files contain potentially sensitive prompts, code, paths, tool output, and credentials accidentally pasted by users. The feature must be conservative.

Requirements:

- No network requests in the core CLI.
- No telemetry, update checks, or remote error reporting.
- Store only the minimum derived metadata needed for bookmark search.
- MVP does not persist or search prompt excerpts. Any later prompt index must be explicitly enabled and define its storage, redaction, and deletion lifecycle before implementation.
- Redact or avoid showing environment variables, tokens, and tool output in diagnostics.
- Treat session titles, paths, notes, tags, and prompts as untrusted terminal text. Escape ANSI control sequences and newlines.
- Do not follow symlinks outside the configured Claude state directory during scanning unless the user explicitly configures that behavior.
- Do not accept a bookmark path or session path that causes writes outside the configured store location.
- Use restrictive POSIX permissions. On platforms without POSIX modes, use the platform's private application-data convention.
- Do not modify permissions of pre-existing Claude files.

## 13. Compatibility and configuration

### Supported environment

- Linux and macOS are required for MVP.
- Windows support is deferred unless path handling and process replacement are implemented and tested separately.
- Node.js version and package manager must be selected during implementation. The recommendation is Node.js 20 or newer with a zero-runtime-dependency core where practical.
- The tool must work with Claude Code's current local session format without depending on a private Claude Code package import.

### Configuration precedence

1. Explicit CLI option.
2. Environment variable.
3. User config file.
4. Platform default.

The config file must not contain authentication credentials. The default Claude state path and session schema are implementation inputs that require a startup probe and a fixture test.

## 14. Exit codes

The CLI uses stable exit codes:

- `0`: Success.
- `1`: General operational error.
- `2`: Invalid input or ambiguous selector.
- `3`: Valid bookmark but missing or unusable session target.
- `4`: Store lock or concurrent-write conflict.
- `5`: Store schema or corruption error.
- `6`: Unsupported integration or Claude Code version.
- `127`: Claude executable not found.

Machine-readable output must include `ok`, `code`, and an error object when `ok` is false.

## 15. JSON output contract

Every command with `--json` emits one JSON document to stdout and diagnostics to stderr. The top-level envelope is:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "list",
  "data": {}
}
```

All success responses require `schemaVersion`, `ok`, `command`, and `data`. The required `data` shapes are:

- `list`: `{ "bookmarks": [<bookmark>] }`.
- `sessions`: `{ "sessions": [<session>], "warnings": [<string>] }`.
- `add`: `{ "bookmark": <bookmark>, "created": true }`.
- `edit`: `{ "bookmark": <bookmark>, "changed": [<field>] }`.
- `remove`: `{ "removed": true, "bookmarkId": <string>, "sessionId": <uuid> }`.
- `doctor`: `{ "checked": <number>, "issues": [<issue>], "repaired": <number> }`.
- `open`: `{ "bookmark": <bookmark>, "launch": <launch> }`.
- `config path`: `{ "claudeDir": <path>, "store": <path> }`.

The `<bookmark>`, `<session>`, `<issue>`, and `<launch>` objects use stable named fields. Additive fields require a schema version review. Error responses require `schemaVersion`, `ok: false`, `command`, `code`, and `error`.

Success example:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "open",
  "data": {
    "bookmark": {
      "id": "bm_01J...",
      "sessionId": "3f5c1d80-....",
      "name": "Fix import job",
      "note": null,
      "tags": [],
      "createdAt": "2026-09-19T12:00:00.000Z",
      "updatedAt": "2026-09-19T12:02:00.000Z",
      "lastOpenedAt": null,
      "snapshot": {
        "title": "Fix import job",
        "cwd": "~/work/my-app",
        "projectKey": "-home-user-work-my-app",
        "sessionMtime": "2026-09-18T16:31:22.000Z",
        "lastActivityAt": "2026-09-18T16:30:11.000Z"
      }
    },
    "launch": {
      "executable": "claude",
      "args": ["--resume", "3f5c1d80-...."],
      "cwd": "~/work/my-app"
    }
  }
}
```

Error example:

```json
{
  "schemaVersion": 1,
  "ok": false,
  "command": "open",
  "code": 3,
  "error": {
    "type": "missing_session",
    "message": "The session file is no longer present.",
    "sessionId": "3f5c1d80-...."
  }
}
```

Stable field sets are the fields shown in the bookmark schema in section 7.1, plus `status` when a derived status is returned. A session object contains `sessionId`, `title`, `cwd`, `projectKey`, `lastActivityAt`, `status`, and `isSidechain`. An issue object contains `type`, `message`, and any named target field such as `sessionId` or `bookmarkId`. A launch object contains `executable`, `args`, and `cwd`. The schema must be versioned before it is used by scripts. Human-readable output is not a machine interface.

## 16. Testing requirements

Testing must be fixture-driven and must not use the user's real `~/.claude` directory.

### Unit tests

Cover:

- UUID validation and selector resolution.
- SDK adapter mapping, pagination, refresh, and stable field extraction.
- Fallback JSONL parsing with valid records, malformed records, and incomplete final lines.
- Latest-event selection for titles, cwd, relocation, and activity time in fallback mode.
- Sidechain and `hiddenFromPicker` filtering.
- Encoded project directory handling in fallback mode.
- Search normalization and deterministic ranking.
- Store migration and unknown-field behavior.
- Atomic write and lock conflict behavior.
- ANSI and newline sanitization.
- Exit-code mapping.

### Integration tests

Use a temporary fake Claude state directory and a fake SDK catalog containing:

- Multiple project directories.
- At least two sessions in one project.
- One session with a custom title.
- One with an AI title only.
- One with no title, which falls back to its session ID in metadata-only MVP mode.
- One `-p` or Agent SDK session marked hidden from the native picker but still resumable by UUID.
- One sidechain.
- One missing session after a bookmark is created.
- Two concurrent writers updating the bookmark store.

Run the same cases through the fallback adapter with:

- One active file with an incomplete final JSONL line.
- One relocated session, tested across two scans with the old path removed and the verified UUID unchanged.
- One filename/content UUID mismatch.
- One duplicate UUID collision; assert that no winner is selected.

Use a fake `claude` executable that records argv and cwd, then exits with controlled codes. Assert exact argv, cwd, output, and store mutations.

### End-to-end acceptance checks

1. Discover at least three fixture sessions.
2. Add a bookmark with name, note, and two tags.
3. List it and assert all fields are rendered.
4. Search by name, tag, project, and note.
5. Open by exact name and assert the fake Claude receives `--resume <id>` from the session cwd.
6. Open with `--fork` and assert `--fork-session` is passed.
7. Verify ambiguous selectors fail without launching anything.
8. Delete the session file and verify the bookmark remains and reports `missing`.
9. Run `doctor --repair` and verify no session file is modified.
10. Corrupt the store and verify a nonzero schema error with no destructive recovery.
11. Run two simultaneous mutations and verify no update is lost.
12. Verify UUID mismatches and unrelated duplicate UUIDs are diagnosed and never launched automatically.
13. Confirm no network request is made by the core CLI.

## 17. Acceptance criteria

The feature is ready for implementation review only when all of the following are true:

- A user can bookmark a session by UUID without touching the session file.
- A user can list and search bookmarks without launching Claude Code or opening each candidate session.
- A unique bookmark opens the exact session through the official `claude --resume` interface.
- The launcher starts in the correct project directory or stops safely with a repair action.
- Missing sessions remain visible as stale bookmarks and can be removed explicitly.
- Two sessions with the same project path and similar titles remain independently addressable.
- Names, tags, notes, paths, and derived titles cannot inject terminal control sequences.
- Concurrent writes do not silently overwrite bookmark changes.
- The store is local, private, atomic, and independent from Claude's transcript files.
- All required tests above pass against a temporary fixture tree.
- The implementation documents the tested Claude Code version and any integration limitations.
- The built-in `/resume` behavior is not modified or relied upon for bookmark persistence.

## 18. Implementation phases

### Phase 0: Compatibility probe

- Confirm the installed Claude Code version.
- Capture representative session JSONL fixtures without committing private conversation content, including filename/content UUID mismatch, duplicate UUID collision, continuation, relocation, custom title, AI title, sidechain, malformed line, and active-writer cases.
- Record the fixture's Claude Code and Agent SDK versions, confirm SDK pagination and field behavior, and confirm the fallback fixture's version.
- Confirm exact hook payloads and custom-command behavior for the optional integration.
- Confirm the observed cross-project UUID resume behavior for the target Claude Code version.
- Freeze the adapter, store, and launcher contracts before coding.

### Phase 1: Core index and store

- Implement discovery, metadata extraction, schema validation, atomic persistence, locking, and unit tests.
- Deliver `list`, `sessions`, `add`, `edit`, `remove`, and `doctor`.

### Phase 2: Search and launch

- Implement deterministic selectors and ranking.
- Implement `open`, `--fork`, `--cwd`, `--dry-run`, JSON output, and fake-Claude integration tests.
- Add plain-TTY picker without requiring external dependencies.

### Phase 3: Optional Claude Code integration

- Add only after the Phase 0 probe proves current-session identification.
- Ship `/bookmark` and `/bookmarks` as separate integration assets.
- Add a version guard and a fallback instruction when the integration is unavailable.

### Phase 4: Hardening

- Test large session trees, concurrent writers, interrupted writes, stale locks, path changes, and permission failures.
- Add migration tests before changing schema.
- Document backup, restore, and uninstall behavior.

## 19. Operational and maintenance rules

- Do not use the session transcript as the bookmark database.
- Do not silently prune stale bookmarks.
- Do not overwrite a store after parse failure.
- Do not launch a bookmark from an unrelated directory when the recorded project directory is missing unless the user explicitly supplies `--allow-missing-cwd`.
- Do not add a runtime network dependency.
- Do not introduce an LLM or fuzzy-search service for MVP.
- Keep the parser behind an adapter so a future Claude Code session format can be supported without changing the bookmark API.
- Add a fixture and migration note for every observed session schema change.

## 20. Open questions that must be resolved before implementation

These are implementation gates, not reasons to weaken the MVP:

1. What exact hook payload and custom-command expansion are available in the target Claude Code version for obtaining the current session ID?
2. Does the selected Claude Code and Agent SDK version preserve the observed cross-project UUID resume behavior, and what cwd should the launcher use for tool execution context?
3. Which SDK fields identify cloud, teleport, forked, hidden-from-picker, and sidechain sessions in the target version?
4. If prompt search is proposed after MVP, what explicit opt-in, redaction, retention, and deletion policy will govern the local prompt index?
5. What Node.js version and package manager are standard for this project once implementation begins?
6. Is a plain line-oriented picker sufficient, or is an optional `fzf` adapter required for the intended daily workflow?

Until these questions are answered with fixtures or official documentation, the implementation must use the conservative fallback behavior specified above.

## 21. Evidence baseline

The specification is grounded in the following observations and official references, checked on 2026-09-19:

- Installed Claude Code: `2.1.278` (`claude --version`).
- Official sessions documentation: <https://code.claude.com/docs/en/sessions.md>.
- Official Claude directory documentation: <https://code.claude.com/docs/en/claude-directory.md>.
- Official Agent SDK sessions API: <https://code.claude.com/docs/en/agent-sdk/sessions.md>.
- Official hooks documentation: <https://code.claude.com/docs/en/hooks.md>.
- Official skills documentation: <https://code.claude.com/docs/en/skills.md>.

The local installation contains session JSONL files and title events, but the JSONL format is internal and may change. The implementation must prefer the Agent SDK catalog and mutators, keep the JSONL adapter read-only, and rerun the compatibility probe after a Claude Code or SDK upgrade. The built-in CLI has no first-class star or pin list, and plugins or hooks cannot inject rows into the native `/resume` picker.

## 22. Definition of done for the specification phase

This specification phase is complete when:

- The repository contains this document and no product code has been added.
- The empty-repository constraint is explicit.
- The sidecar-store and launcher boundaries are explicit.
- Session discovery, stale records, concurrent writes, privacy, and terminal safety are covered.
- The optional integration cannot block the core feature.
- The implementation team has commands, data schemas, error codes, acceptance tests, and compatibility gates precise enough to build without guessing product behavior.
