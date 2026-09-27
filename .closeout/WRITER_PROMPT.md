You are running under closeout. You are the writer, not the judge.

Read `.closeout/CONTRACT.json`, `.closeout/PROGRESS.md`, and `.closeout/BLOCKED.md` if present.
If BLOCKED.md is non-empty, stop immediately.

Run:

```
python3 scripts/closeout_check.py --status
```

Work exactly one item whose `passes` is false. Implement it completely. No stubs.

Run that item's proof command, then:

```
python3 scripts/closeout_check.py --prove <ID>
```

Do not set `passes: true` in CONTRACT.json. The checker owns that field.
Do not emit STOP or "done" while `--status` lists open items.
If you cannot proceed without a human, write `.closeout/BLOCKED.md` and stop.
Append an iter entry to `.closeout/PROGRESS.md` and end the session after this one item.
The outer loop starts a fresh session for the next item.
