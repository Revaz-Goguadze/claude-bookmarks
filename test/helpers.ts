import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = path.join(ROOT, 'src', 'cli.ts');

export const UUID_A = '3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f';
export const UUID_B = '7c4e1a9b-2d3f-4a5b-8c6d-9e0f1a2b3c4d';
export const UUID_C = 'b1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
export const UUID_D = 'e9f8a7b6-c5d4-4e3f-a2b1-c0d9e8f7a6b5';
export const UUID_E = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';
export const UUID_UNKNOWN = '00000000-1111-4222-8333-444444444444';

export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface Sandbox {
  root: string;
  home: string;
  configDir: string;
  storeDir: string;
  store: string;
  fakeBin: string;
  fakeLog: string;
  workDir: string;
  env: Record<string, string>;
}

export interface RunResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

export interface SessionFixture {
  id: string;
  cwd: string;
  prompt: string;
  timestamp: string;
  configDir?: string;
}

const FAKE_CLAUDE = `#!/bin/sh
for a in "$@"; do printf '%s\\n' "$a" >> "$FAKE_LOG"; done
pwd -P >> "$FAKE_LOG"
exit \${FAKE_EXIT:-0}
`;

const sandboxes: string[] = [];

process.on('exit', () => {
  for (const dir of sandboxes) fs.rmSync(dir, { recursive: true, force: true });
});

export function makeSandbox(): Sandbox {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cbm-test-')));
  sandboxes.push(root);
  const home = path.join(root, 'home');
  const configDir = path.join(root, 'config');
  const storeDir = path.join(root, 'store');
  const workDir = path.join(root, 'work');
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(home);
  fs.mkdirSync(configDir);
  fs.mkdirSync(workDir);
  fs.mkdirSync(binDir);
  const fakeBin = path.join(binDir, 'fake-claude');
  fs.writeFileSync(fakeBin, FAKE_CLAUDE);
  fs.chmodSync(fakeBin, 0o755);
  const store = path.join(storeDir, 'bookmarks.json');
  const fakeLog = path.join(root, 'fake.log');
  return {
    root,
    home,
    configDir,
    storeDir,
    store,
    fakeBin,
    fakeLog,
    workDir,
    env: {
      PATH: '/usr/bin:/bin',
      HOME: home,
      CLAUDE_CONFIG_DIR: configDir,
      CBM_STORE: store,
      CBM_CLAUDE_BIN: fakeBin,
      FAKE_LOG: fakeLog,
    },
  };
}

// A real directory used as a session's project cwd.
export function makeProject(sb: Sandbox, name: string): string {
  const dir = path.join(sb.root, 'projects', name);
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

export function projectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export function writeSession(sb: Sandbox, s: SessionFixture): string {
  const configDir = s.configDir ?? sb.configDir;
  const dir = path.join(configDir, 'projects', projectDirName(s.cwd));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${s.id}.jsonl`);
  const line = {
    type: 'user',
    sessionId: s.id,
    cwd: s.cwd,
    timestamp: s.timestamp,
    uuid: 'a1',
    parentUuid: null,
    isSidechain: false,
    message: { role: 'user', content: s.prompt },
  };
  fs.writeFileSync(file, JSON.stringify(line) + '\n');
  const t = new Date(s.timestamp);
  fs.utimesSync(file, t, t);
  return file;
}

export function run(
  sb: Sandbox,
  args: string[],
  opts: { env?: Record<string, string | undefined>; cwd?: string } = {},
): RunResult {
  const env: Record<string, string> = {};
  const merged: Record<string, string | undefined> = { ...sb.env, ...(opts.env ?? {}) };
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined) env[k] = v;
  }
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd ?? sb.workDir,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (r.error) throw r.error;
  return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr };
}

export interface StoreRecord {
  id: string;
  name: string;
  tags: string[];
  note: string;
  cwd: string;
  createdAt: string;
  lastOpenedAt: string | null;
}

export interface StoreFile {
  version: number;
  bookmarks: StoreRecord[];
}

export function readStore(sb: Sandbox, file: string = sb.store): StoreFile {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as StoreFile;
}

export function record(sb: Sandbox, id: string): StoreRecord {
  const found = readStore(sb).bookmarks.find((b) => b.id === id);
  if (!found) throw new Error(`no record ${id} in store`);
  return found;
}

export function writeStore(sb: Sandbox, content: string): void {
  fs.mkdirSync(sb.storeDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(sb.store, content, { mode: 0o600 });
}

export function readFakeLog(sb: Sandbox): { argv: string[]; cwd: string } | null {
  if (!fs.existsSync(sb.fakeLog)) return null;
  const lines = fs.readFileSync(sb.fakeLog, 'utf8').split('\n');
  lines.pop();
  const cwd = lines.pop() as string;
  return { argv: lines, cwd };
}

export function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function hoursAgoIso(hours: number): string {
  const base = Math.floor(Date.now() / 1000) * 1000;
  return new Date(base - hours * 3_600_000).toISOString();
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Runs `cbm add` and throws with the CLI output when it does not exit 0.
export function addOk(sb: Sandbox, args: string[], opts: { env?: Record<string, string | undefined> } = {}): RunResult {
  const r = run(sb, ['add', ...args], opts);
  if (r.status !== 0) {
    throw new Error(`cbm add ${args.join(' ')} exited ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  }
  return r;
}
