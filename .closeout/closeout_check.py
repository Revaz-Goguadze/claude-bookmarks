#!/usr/bin/env python3
"""closeout_check.py — the harness, not the model, stamps done.

Stdlib only. Exit codes:
  0  all items proven this run (SEALED)
  1  open / failed proofs
  2  BLOCKED.md present
  3  contract invalid / tautological / lint failed
  4  usage / missing files
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

def _root() -> Path:
    closeout_root = (os.environ.get("CLOSEOUT_ROOT") or "").strip()
    if closeout_root:
        return Path(closeout_root)
    cwd = Path.cwd()
    if (cwd / ".closeout" / "CONTRACT.json").is_file():
        return cwd
    for key in ("GROK_WORKSPACE_ROOT", "CLAUDE_PROJECT_DIR"):
        value = (os.environ.get(key) or "").strip()
        if value:
            return Path(value)
    return cwd


ROOT = _root()
DIR = ROOT / ".closeout"
CONTRACT_PATH = DIR / "CONTRACT.json"
PROGRESS_PATH = DIR / "PROGRESS.md"
BLOCKED_PATH = DIR / "BLOCKED.md"
FREEZE_PATH = DIR / "FREEZE.sha256"
LOG_DIR = DIR / "logs"

WEAK_PROOF = re.compile(
    r"^\s*(echo|true|printf|:)\b|"
    r"^\s*exit\s+0\s*$|"
    r"^\s*(ls|test\s+-f|test\s+-e|test\s+-d)\b(?!.*&&)",
    re.I,
)
WEAK_EXPECT = {"", ".", ".*", "ok", "done", "success", "pass", "true", "yes"}


def die(code: int, msg: str) -> None:
    print(f"closeout: {msg}", file=sys.stderr)
    raise SystemExit(code)


def load_contract() -> dict:
    if not CONTRACT_PATH.is_file():
        die(4, f"missing {CONTRACT_PATH}. Copy templates/CONTRACT.json there first.")
    try:
        data = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        die(4, f"CONTRACT.json is not valid JSON: {e}")
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        die(4, "CONTRACT.json must be an object with an items array")
    return data


def save_contract(data: dict) -> None:
    CONTRACT_PATH.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def contract_digest(data: dict) -> str:
    """Hash of the frozen fields only — not passes/evidence."""
    frozen = {
        "objective": data.get("objective"),
        "in_scope": data.get("in_scope"),
        "out_scope": data.get("out_scope"),
        "forbidden": data.get("forbidden"),
        "budget": data.get("budget"),
        "items": [
            {
                "id": it.get("id"),
                "requirement": it.get("requirement"),
                "proof": it.get("proof"),
                "expect": it.get("expect"),
                "artifact": it.get("artifact"),
            }
            for it in data.get("items", [])
        ],
    }
    blob = json.dumps(frozen, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def lint_items(data: dict) -> list[str]:
    errors: list[str] = []
    items = data.get("items") or []
    if not items:
        errors.append("contract has zero items")
    seen = set()
    for i, it in enumerate(items):
        iid = str(it.get("id") or f"item[{i}]")
        if iid in seen:
            errors.append(f"{iid}: duplicate id")
        seen.add(iid)
        req = (it.get("requirement") or "").strip()
        proof = (it.get("proof") or "").strip()
        expect = (it.get("expect") or "").strip()
        artifact = (it.get("artifact") or "").strip()
        if not req or req.upper().startswith("REPLACE"):
            errors.append(f"{iid}: requirement is empty or still a placeholder")
        if not proof or proof.upper().startswith("REPLACE"):
            errors.append(f"{iid}: proof command is empty or still a placeholder")
        elif WEAK_PROOF.search(proof):
            errors.append(f"{iid}: proof is tautological ({proof!r})")
        if "CONTRACT.json" in proof or "STATE.json" in proof:
            errors.append(f"{iid}: proof must not write the contract")
        if expect.lower() in WEAK_EXPECT or expect.upper().startswith("REPLACE"):
            errors.append(f"{iid}: expect {expect!r} is too weak — use a distinctive token")
        if artifact.upper().startswith("REPLACE"):
            errors.append(f"{iid}: artifact still a placeholder")
        if artifact in {".closeout/CONTRACT.json", ".closeout/PROGRESS.md", ".closeout/BLOCKED.md"}:
            errors.append(f"{iid}: artifact cannot be a closeout control file")
    obj = (data.get("objective") or "").strip()
    if not obj or obj.upper().startswith("REPLACE"):
        errors.append("objective is empty or still a placeholder")
    return errors


def run_proof(it: dict, timeout: int) -> dict:
    proof = (it.get("proof") or "").strip()
    expect = it.get("expect") or ""
    artifact = (it.get("artifact") or "").strip()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"{it.get('id', 'item')}-{int(time.time())}.txt"
    try:
        proc = subprocess.run(
            proof,
            shell=True,
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=timeout,
            env=os.environ.copy(),
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        exit_code = proc.returncode
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or "") + (e.stderr or "") + f"\n[timeout after {timeout}s]"
        exit_code = 124
    log_path.write_text(out[-200_000:], encoding="utf-8", errors="replace")
    # grep -q prints nothing on success. If the expect token is in the
    # proof command itself, exit 0 is the assertion.
    expect_ok = bool(expect) and (expect in out or (exit_code == 0 and expect in proof))
    artifact_ok = True
    if artifact:
        artifact_ok = (ROOT / artifact).exists()
    ok = exit_code == 0 and expect_ok and artifact_ok
    return {
        "ok": ok,
        "exit": exit_code,
        "expect_ok": expect_ok,
        "artifact_ok": artifact_ok,
        "log": str(log_path.relative_to(ROOT)),
        "tail": out[-1200:],
    }


def cmd_status(data: dict) -> int:
    if BLOCKED_PATH.is_file() and BLOCKED_PATH.stat().st_size > 10:
        print("status: BLOCKED")
        print(BLOCKED_PATH.read_text(encoding="utf-8")[:2000])
        return 2
    open_ids, pass_ids = [], []
    for it in data["items"]:
        (pass_ids if it.get("passes") else open_ids).append(it.get("id"))
    print(f"objective: {data.get('objective')}")
    print(f"open:   {', '.join(open_ids) or '(none)'}")
    print(f"proven: {', '.join(pass_ids) or '(none)'}")
    print(f"freeze: {'yes' if FREEZE_PATH.is_file() else 'NO — run --red first'}")
    if open_ids:
        return 1
    return 0


def cmd_red(data: dict) -> int:
    errors = lint_items(data)
    if errors:
        for e in errors:
            print(f"lint: {e}", file=sys.stderr)
        return 3
    timeout = int((data.get("budget") or {}).get("timeout_sec") or 180)
    fails = 0
    for it in data["items"]:
        it["passes"] = False
        it["evidence"] = None
        result = run_proof(it, timeout)
        mark = "FAIL" if not result["ok"] else "PASS"
        if not result["ok"]:
            fails += 1
        print(f"RED {it['id']}: {mark} exit={result['exit']} expect={result['expect_ok']} log={result['log']}")
    if fails == 0:
        print(
            "closeout: every proof already passes on this tree.\n"
            "That means the contract is tautological — it cannot detect missing work.\n"
            "Write proofs that fail NOW (missing feature, failing test, missing file), then freeze.",
            file=sys.stderr,
        )
        return 3
    digest = contract_digest(data)
    FREEZE_PATH.write_text(digest + "\n", encoding="utf-8")
    save_contract(data)
    print(f"frozen {fails}/{len(data['items'])} currently failing. digest={digest[:16]}")
    return 0


def cmd_prove(data: dict, only_id: str | None) -> int:
    if not FREEZE_PATH.is_file():
        die(3, "no freeze. Run --red after writing CONTRACT.json.")
    frozen = FREEZE_PATH.read_text(encoding="utf-8").strip()
    current = contract_digest(data)
    if frozen != current:
        die(
            3,
            "CONTRACT frozen fields changed after --red. "
            "Re-freeze with --red if the change is intentional, do not silently edit proofs.",
        )
    errors = lint_items(data)
    if errors:
        for e in errors:
            print(f"lint: {e}", file=sys.stderr)
        return 3
    timeout = int((data.get("budget") or {}).get("timeout_sec") or 180)
    failed = []
    for it in data["items"]:
        if only_id and it.get("id") != only_id:
            continue
        result = run_proof(it, timeout)
        it["passes"] = bool(result["ok"])
        it["evidence"] = {
            "exit": result["exit"],
            "log": result["log"],
            "expect_ok": result["expect_ok"],
            "artifact_ok": result["artifact_ok"],
            "ts": int(time.time()),
        }
        mark = "PASS" if result["ok"] else "FAIL"
        print(f"{it['id']}: {mark} exit={result['exit']} expect={result['expect_ok']} artifact={result['artifact_ok']} log={result['log']}")
        if not result["ok"]:
            failed.append(it["id"])
            tail = result["tail"].strip()
            if tail:
                print("--- output tail ---")
                print(tail[-800:])
                print("-------------------")
    save_contract(data)
    if BLOCKED_PATH.is_file() and BLOCKED_PATH.stat().st_size > 10:
        print("BLOCKED.md is present — human handoff required")
        return 2
    if failed:
        print(f"still open: {', '.join(str(x) for x in failed)}")
        return 1
    still_open = [it.get("id") for it in data["items"] if not it.get("passes")]
    if still_open:
        print(f"item proven; still open: {', '.join(str(x) for x in still_open)}")
        return 0 if only_id else 1
    print("SEALED: every item proven this run")
    return 0


def _hook_should_allow(raw: str) -> bool:
    """True means allow stop (already continuing, session-end, or no payload)."""
    if os.environ.get("CLOSEOUT_HOOK_ACTIVE") == "1":
        return True
    if not raw:
        return False
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return False
    if payload.get("stop_hook_active") is True or payload.get("stopHookActive") is True:
        return True
    # Grok fires an observe-only Stop at session end. Do not run proofs.
    if payload.get("reason") in {"channel_closed", "shutdown"}:
        return True
    return False


def _block_stop(reason: str) -> int:
    """Block stop on Kimi (exit 2 + stderr) and Grok/Claude (JSON decision)."""
    print(json.dumps({"decision": "block", "reason": reason}))
    print(reason, file=sys.stderr)
    return 2


def cmd_hook() -> int:
    """Stop-hook entry. Exit 2 to block stop. Exit 0 to allow.

    Anti-loop: if CLOSEOUT_HOOK_ACTIVE=1 or stdin says stop_hook_active /
    stopHookActive, allow stop so the harness does not spin. The outer
    bash / Ralph / grok -p loop is the real continuation engine.
    """
    raw = ""
    if not sys.stdin.isatty():
        raw = sys.stdin.read() or ""
    if _hook_should_allow(raw):
        return 0
    if not CONTRACT_PATH.is_file():
        return 0
    if BLOCKED_PATH.is_file() and BLOCKED_PATH.stat().st_size > 10:
        return 0
    data = load_contract()
    open_ids = [it.get("id") for it in data.get("items", []) if not it.get("passes")]
    if not open_ids:
        # still demand a fresh prove-all so stale checkboxes cannot seal
        rc = cmd_prove(data, None)
        if rc == 0:
            return 0
        return _block_stop(
            "closeout hook: contract claimed sealed but a fresh prove failed. "
            "Re-run the failing proofs. Do not emit STOP."
        )
    return _block_stop(
        "closeout hook: open items remain: "
        + ", ".join(str(x) for x in open_ids)
        + ". Run the next item's proof. Do not emit STOP. Do not declare done."
    )


def cmd_next(data: dict) -> int:
    if BLOCKED_PATH.is_file() and BLOCKED_PATH.stat().st_size > 10:
        print("BLOCKED")
        return 2
    for it in data["items"]:
        if not it.get("passes"):
            print(it["id"])
            print(it.get("requirement") or "")
            print(it.get("proof") or "")
            return 1
    print("NONE")
    return 0


USAGE = """closeout_check.py — harness-owned done bit

  python3 closeout_check.py --status
  python3 closeout_check.py --red
  python3 closeout_check.py --prove [ID]
  python3 closeout_check.py --prove-all
  python3 closeout_check.py --next
  python3 closeout_check.py --hook
"""


def main(argv: list[str]) -> int:
    if not argv or argv[0] in {"-h", "--help"}:
        print(USAGE)
        return 4
    cmd = argv[0]
    if cmd == "--hook":
        return cmd_hook()
    data = load_contract()
    if cmd == "--status":
        return cmd_status(data)
    if cmd == "--red":
        return cmd_red(data)
    if cmd == "--prove-all":
        return cmd_prove(data, None)
    if cmd == "--prove":
        only = argv[1] if len(argv) > 1 else None
        return cmd_prove(data, only)
    if cmd == "--next":
        return cmd_next(data)
    print(USAGE, file=sys.stderr)
    return 4


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
