---
description: Bookmark the current session with cbm
argument-hint: <name> [#tag ...]
allowed-tools: Bash(cbm:*)
---

Bookmark this Claude Code session with the `cbm` CLI.

Arguments: `$ARGUMENTS`

Split the arguments into words. Every word starting with `#` is a tag; pass each one as `--tag '<word>'` in single quotes (an unquoted `#` starts a shell comment). All other words, joined by single spaces in their original order, form the bookmark name; pass it as `--name '<name>'` in single quotes, writing any `'` inside the name as `'\''`. Leave out `--name` when there are no such words, and leave out `--tag` when there are no tags.

Then run exactly one command:

```
cbm add ${CLAUDE_SESSION_ID} --name '<name>' --tag '<tag>' ...
```

Show the command output to the user. If `cbm` exits with an error, show its message and do not retry with different arguments.
