# Branch-pinned bookmarks

## Goal
One session .jsonl can hold several conversation branches, and `claude --resume <uuid>` always opens the chain ending at the last-appended message. A bookmark made on an older branch therefore reopens the wrong conversation (incident: "sft-training-lora" on ba16df6a opened the local-testing branch). After this change `cbm add` pins the branch being worked on, and `cbm open` always lands on that branch. It does so by resuming normally when the branch is still current, or else by copying the branch into a new session and repointing the bookmark to it. The source transcript is never modified.

## Scope
- `src/store.ts`: optional `leafUuid` on `Bookmark`, accepted by the store validator.
- `src/cli.ts` `add` and `open` (including `--print-command`, `--fork`); new helpers may live in a new `src/branch.ts`.
- `README.md`: one paragraph on pinning, naming the `leafUuid` store field.
- Tests: new `test/pin.test.ts`; update `test/add.test.ts:39-52,81-82` and `test/list-json.test.ts:42-68,83-93` to expect `leafUuid: 'a1'`; `test/helpers.ts` may gain a multi-record transcript writer and `leafUuid?: string` on `StoreRecord`.

## Non-goals
- No change to `list`, `sessions`, `edit`, `remove`, flags, usage text or exit codes: pinning is invisible outside add/open.
- No backfill of pins for old bookmarks, and no `--leaf` flag: plan item 4 keeps old records unchanged. The incident bookmark is repaired by hand-editing the store's `leafUuid`.
- No store version bump, no new dependency (`test/cli.test.ts:14` pins deps), no npm publish, no Claude Code changes.
- No deletion or rewrite of any .jsonl; no cleanup of earlier copies.

## Interfaces
- Store record: the existing 7 keys plus optional `leafUuid: string`. Any other shape, including a non-string `leafUuid`, fails to load with `store_corrupt` (exit 1). `version` stays 1.
- Resumed chain R(id) = `getSessionMessages(id, { includeSystemMessages: true })` from `@anthropic-ai/claude-agent-sdk`. Its last element is the message `claude --resume` opens.
- `cbm add`: after the existing checks, `leafUuid` = uuid of the last element of R(id); the key is omitted when R(id) is empty. Stdout is unchanged.
- `cbm open`, after the existing session-missing (exit 4) and cwd (exit 3) checks:
  1. No `leafUuid`: behave exactly as today.
  2. `leafUuid` is in R(id): resume `id` as today; the store is unchanged apart from `lastOpenedAt`.
  3. `leafUuid` is not in any record of the source file: stderr `cbm: warning: pinned message <leafUuid> is not in session <id>; opening its latest branch`, then as case 2.
  4. Otherwise it is stale. The source file is the first `<claudeDir>/projects/*/<id>.jsonl`, where claudeDir = `$CLAUDE_CONFIG_DIR` else `~/.claude`. Target T = the record with the greatest line index among `leafUuid` and its descendants via `parentUuid`. Only records whose `uuid` is a string, whose type is user, assistant, attachment, system or progress, and with `isSidechain !== true` count. `newId = (await forkSession(id, { upToMessageId: T, title: bookmark.name })).sessionId`. The bookmark's `id` becomes newId and its `leafUuid` becomes the last uuid of R(newId); the store is saved before launch or print. Stderr: `cbm: "<name>" is pinned to an older branch of <id>; copied it to new session <newId>`. Then launch or print as today with newId. `--fork` yields `--resume <newId> --fork-session`. `--print-command` prints `cd '<cwd>' && '<bin>' --resume <newId>` and leaves `lastOpenedAt` unchanged.
  5. If `forkSession` throws, throw `CbmError('internal', 'could not copy the pinned branch of <id>: <message>')` (exit 1): the store is not written and claude does not run.

## Acceptance criteria
Fixtures are UUID-shaped records `{type, uuid, parentUuid, sessionId, cwd, timestamp, isSidechain:false, message}`. A user message is `{role:'user', content:'<text>'}`; an assistant message is `{role:'assistant', content:[{type:'text', text:'<text>'}]}`. Timestamps ascend in file order. "Two-branch" means root user u1 then assistant a2, branch A (u3 then a4, parent a2) written and bookmarked with `cbm add`, then branch B (u5 then a6, parent a2) appended. Test names start with `B<n> `.
- B1 `cbm add` on a `writeSession` fixture stores the 7 old fields plus `leafUuid: 'a1'`, and `cbm list --json` shows `leafUuid: 'a1'` on that bookmark.
- B2 `cbm add` on a session whose file holds branch A then branch B stores `leafUuid` = a6.
- B3 A store record without `leafUuid` opens with argv `--resume <id>`. No new .jsonl appears, and afterwards the record still has no `leafUuid` key and only `lastOpenedAt` changed.
- B4 Pinned at a4, then u7 then a8 appended under a4: `open` runs `--resume <id>`, no new .jsonl appears, and `id` and `leafUuid` are unchanged.
- B5 Two-branch `open` exits with the fake claude's code, and argv is `--resume <newId>` in the bookmark cwd. newId is a lowercase UUID different from id. The project dir holds exactly `<id>.jsonl` and `<newId>.jsonl`, and the source is byte-identical.
- B6 In B5's new file every record's `sessionId` is newId. Its user and assistant texts in order are the root prompt, root reply, A prompt and A reply. The last user/assistant record has `forkedFrom` `{sessionId:<id>, messageUuid:a4}`. A `custom-title` record has `customTitle` equal to the bookmark name, and the file mode is 0600.
- B7 After B5 the record deep-equals the old record with `id: newId`, `leafUuid` = uuid of the new file's last user/assistant record, and `lastOpenedAt` an ISO time in the test window. Stderr contains id and newId.
- B8 A second `open` after B5 runs `--resume <newId>`, the project dir still holds exactly 2 .jsonl files, and the store's `id` stays newId.
- B9 Pinned at a4, then u7 then a8 under a4, then branch B appended: `open` copies up to a8. The new file's last user/assistant record has `forkedFrom.messageUuid` = a8, and its texts include both A exchanges.
- B10 Two-branch `open --print-command` exits 0, stdout is exactly `cd '<cwd>' && '<fakeBin>' --resume <newId>\n`, the fake claude does not run, the record has `id` newId and `lastOpenedAt` null, and a second `--print-command` prints the same line without creating a third .jsonl.
- B11 Two-branch `open --fork` runs argv `--resume <newId> --fork-session`.
- B12 With `leafUuid` hand-set to a uuid absent from the file, `open` runs `--resume <id>`, stderr contains `warning`, no new .jsonl appears, and the store is byte-identical except `lastOpenedAt`.
- B13 Two-branch with the bookmark cwd removed: `open` exits 3, no new .jsonl appears, and the store is byte-identical.
- B14 Two-branch with the project dir chmod 0555: `open` exits 1 with stderr starting `cbm: `, the fake claude does not run, no new .jsonl appears, and the store is byte-identical.
- B15 A store record with `"leafUuid": 5` makes `cbm list` exit 1 with stderr containing `store`, and the file is byte-identical.
- B16 README.md contains `leafUuid`.
- B17 `node --test test/` passes in full, including the updated add and list-json tests.

## Decisions
- Copy via SDK `forkSession`, not a hand-rolled parentUuid walk. The walk drops compaction-preserved segments and sibling tool results (1 of 244 on the ba16df6a SFT branch), and original SPEC.md §2/§8 prefers SDK mutators. Cost: copied message uuids are new, so `leafUuid` is re-read from the copy.
- Branch currency comes from SDK R(id), which picks by file position (`sdk.mjs` `gE`), not by newest timestamp as the task text said.
- The pin at add is the last element of R(id), not the last uuid record in the file, which can be an attachment outside R and would never match.
- Copy up to the pin's newest descendant, not the pin itself. `/bookmark` pins the assistant tool_use that runs `cbm add`; its result and reply come after it (ba16df6a: pin at line 3530, branch ends at line 3535).
- Copy title = bookmark name. The SDK default `<source title> (fork)` shows the newest branch's ai-title.
- `--print-command` copies and repoints so the printed command opens the pinned branch; the alternative prints the wrong branch.
- A pin missing from the file warns and resumes the latest branch; an error exit was rejected as too harsh for a hand-edited store.
- `leafUuid` is exposed in `list --json` through the existing spread. Store version stays 1; pre-change cbm builds reject pinned records.
- After a repoint, the old uuid or its prefix no longer selects the bookmark; the name still does.

## Gotchas
- `src/store.ts:36-38` validates an exact key set; add the optional key without loosening the other checks.
- `src/cli.ts:209-219`: the session (4) and cwd (3) checks run before any copy. `cli.ts:224-227` returns before spawn, and `lastOpenedAt` is set only on spawn (`cli.ts:245-251`).
- `forkSession` omitting `dir` searches every project dir, as `getSessionInfo` does. It writes into the source's dir, stamps the last copied record with the current time, and copies any other-branch records that sit earlier in the file (harmless, because they are off R).
- Skip unparsable lines when scanning the source: a live Claude may leave a partial final line.
- `test/helpers.ts:108-127` `writeSession` writes one record with uuid `a1`. B14 does not block writes when run as root.
