#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { parseArgs } from 'node:util';
import type { ParseArgsOptionsConfig } from 'node:util';
import { getSessionInfo, listSessions } from '@anthropic-ai/claude-agent-sdk';
import { CbmError } from './errors.ts';
import {
  assertNameFree,
  loadStore,
  normalizeName,
  normalizeSessionId,
  normalizeTags,
  resolveSelector,
  saveStore,
} from './store.ts';
import type { Bookmark } from './store.ts';

const USAGE = `Usage: cbm <command> [options]

Commands:
  add <uuid> [--name N] [--tag T]... [--note X]      bookmark a Claude Code session
  list [query] [--tag T]... [--json]                 list and search bookmarks
  open <selector> [--fork] [--print-command] [--allow-missing-cwd]
                                                     resume a bookmarked session
  sessions [query] [--limit N] [--json]              list recent Claude Code sessions
  edit <selector> [--name N] [--add-tag T]... [--rm-tag T]... [--note X]
                                                     change a bookmark
  remove <selector>                                  delete a bookmark (never the session)

A selector is a bookmark name (any case), a session uuid, or a uuid prefix of 8+ chars.
Store: $CBM_STORE, else $CLAUDE_CONFIG_DIR/bookmarks.json, else ~/.claude/bookmarks.json.
`;

// Where a command's result goes: list and sessions switch errors to a JSON line on stdout.
interface Output {
  json: boolean;
}

function parse<O extends ParseArgsOptionsConfig>(args: string[], options: O, positionals: { min: number; max: number }) {
  let parsed;
  try {
    parsed = parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (err) {
    throw new CbmError('usage', (err as Error).message);
  }
  const n = parsed.positionals.length;
  if (n < positionals.min || n > positionals.max) {
    throw new CbmError('usage', `wrong number of arguments\n${USAGE}`);
  }
  return parsed;
}

// A session started by a slash command has that command as its summary; it makes a useless name.
function defaultName(id: string, text: string): string {
  const name = sanitize(text).replace(/\s+/g, ' ').trim().slice(0, 60);
  return name === '' || name.startsWith('/') ? `session ${id.slice(0, 8)}` : name;
}

function sanitize(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ');
}

function age(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function touched(b: Bookmark): string {
  return b.lastOpenedAt !== null && b.lastOpenedAt > b.createdAt ? b.lastOpenedAt : b.createdAt;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + '\n');
}

async function add(args: string[]): Promise<void> {
  const { values, positionals } = parse(
    args,
    { name: { type: 'string' }, tag: { type: 'string', multiple: true }, note: { type: 'string' } },
    { min: 1, max: 1 },
  );
  const id = normalizeSessionId(positionals[0]);
  const givenName = values.name === undefined ? undefined : normalizeName(values.name);
  const store = loadStore();
  const existing = store.bookmarks.find((b) => b.id === id);
  if (existing) throw new CbmError('duplicate_session', `session ${id} is already bookmarked as "${existing.name}"`);
  const info = await getSessionInfo(id);
  if (!info) throw new CbmError('session_missing', `no Claude Code session ${id} found`);
  const name = givenName ?? normalizeName(defaultName(id, info.customTitle ?? info.summary));
  assertNameFree(store, name);
  let cwd = info.cwd;
  if (cwd === undefined) {
    cwd = process.cwd();
    process.stderr.write(`cbm: warning: session ${id} has no recorded directory; using ${cwd}\n`);
  }
  store.bookmarks.push({
    id,
    name,
    tags: normalizeTags(values.tag ?? []),
    note: values.note ?? '',
    cwd,
    createdAt: new Date().toISOString(),
    lastOpenedAt: null,
  });
  saveStore(store);
  process.stdout.write(`Bookmarked "${name}" (${id})\n`);
}

async function list(args: string[], out: Output): Promise<void> {
  const { values, positionals } = parse(
    args,
    { tag: { type: 'string', multiple: true }, json: { type: 'boolean' } },
    { min: 0, max: Infinity },
  );
  out.json = values.json === true;
  const store = loadStore();
  const query = positionals.join(' ').toLowerCase();
  const wanted = normalizeTags(values.tag ?? []);
  const rows = await Promise.all(
    store.bookmarks.map(async (b) => {
      const info = await getSessionInfo(b.id);
      return { ...b, status: info ? 'ready' : 'missing', summary: info ? info.summary : null };
    }),
  );
  const shown = rows
    .filter((r) => wanted.every((t) => r.tags.includes(t)))
    .filter((r) => {
      if (query === '') return true;
      const fields = [r.name, r.note, r.summary ?? '', ...r.tags];
      return fields.some((f) => f.toLowerCase().includes(query));
    })
    .sort((x, y) => {
      const a = touched(x);
      const b = touched(y);
      return a < b ? 1 : a > b ? -1 : 0;
    });

  if (out.json) {
    printJson({ ok: true, data: { bookmarks: shown } });
    return;
  }
  if (store.bookmarks.length === 0) {
    process.stdout.write('No bookmarks yet. Add one with: cbm add <session-uuid> --name <name>\n');
    return;
  }
  for (const r of shown) {
    const when = age(Date.parse(r.lastOpenedAt ?? r.createdAt));
    process.stdout.write(`${r.name}  [${r.tags.join(', ')}]  ${r.status}  ${when}  ${r.cwd}\n`);
  }
}

async function sessions(args: string[], out: Output): Promise<void> {
  const { values, positionals } = parse(
    args,
    { limit: { type: 'string', default: '20' }, json: { type: 'boolean' } },
    { min: 0, max: Infinity },
  );
  out.json = values.json === true;
  if (!/^\d+$/.test(values.limit) || Number(values.limit) < 1) {
    throw new CbmError('usage', `--limit must be a positive integer, got "${values.limit}"`);
  }
  const limit = Number(values.limit);
  const query = positionals.join(' ').toLowerCase();
  const names = new Map(loadStore().bookmarks.map((b) => [b.id, b.name]));
  const found = (await listSessions())
    .filter((s) => query === '' || s.summary.toLowerCase().includes(query))
    .sort((x, y) => y.lastModified - x.lastModified)
    .slice(0, limit)
    .map((s) => ({
      sessionId: s.sessionId,
      summary: s.summary,
      customTitle: s.customTitle ?? null,
      cwd: s.cwd ?? null,
      gitBranch: s.gitBranch ?? null,
      lastModified: s.lastModified,
      bookmarked: names.has(s.sessionId),
      bookmarkName: names.get(s.sessionId) ?? null,
    }));

  if (out.json) {
    printJson({ ok: true, data: { sessions: found } });
    return;
  }
  for (const s of found) {
    const mark = s.bookmarkName === null ? '' : `  [bookmarked: ${s.bookmarkName}]`;
    process.stdout.write(`${s.sessionId}  ${sanitize(s.summary)}  ${age(s.lastModified)}  ${s.cwd ?? ''}${mark}\n`);
  }
}

async function open(args: string[]): Promise<void> {
  const { values, positionals } = parse(
    args,
    { fork: { type: 'boolean' }, 'print-command': { type: 'boolean' }, 'allow-missing-cwd': { type: 'boolean' } },
    { min: 1, max: 1 },
  );
  const store = loadStore();
  const bookmark = resolveSelector(store, positionals[0]);
  if (!(await getSessionInfo(bookmark.id))) {
    throw new CbmError('session_missing', `session ${bookmark.id} for "${bookmark.name}" no longer exists; the bookmark is kept`);
  }
  let cwd = bookmark.cwd;
  if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
    if (!values['allow-missing-cwd']) {
      throw new CbmError('cwd_missing', `project directory ${cwd} no longer exists; pass --allow-missing-cwd to open from the current directory`);
    }
    cwd = process.cwd();
    process.stderr.write(`cbm: warning: project directory ${bookmark.cwd} no longer exists; opening in ${cwd}\n`);
  }
  const bin = process.env.CBM_CLAUDE_BIN || 'claude';
  const claudeArgs = ['--resume', bookmark.id];
  if (values.fork) claudeArgs.push('--fork-session');

  if (values['print-command']) {
    process.stdout.write(`cd ${shellQuote(cwd)} && ${shellQuote(bin)} ${claudeArgs.join(' ')}\n`);
    return;
  }

  process.exitCode = await new Promise<number>((resolve, reject) => {
    // While claude runs it owns the terminal: Ctrl-C and Ctrl-\ are its to handle, and
    // termination signals sent to cbm are passed on so the child is never orphaned.
    const ignore = () => {};
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    const detach = () => {
      process.off('SIGINT', ignore);
      process.off('SIGQUIT', ignore);
      process.off('SIGTERM', forward);
      process.off('SIGHUP', forward);
    };
    process.on('SIGINT', ignore);
    process.on('SIGQUIT', ignore);
    process.on('SIGTERM', forward);
    process.on('SIGHUP', forward);
    const child = spawn(bin, claudeArgs, { cwd, stdio: 'inherit', env: process.env });
    child.on('spawn', () => {
      bookmark.lastOpenedAt = new Date().toISOString();
      try {
        saveStore(store);
      } catch (err) {
        process.stderr.write(`cbm: warning: could not record lastOpenedAt: ${(err as Error).message}\n`);
      }
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      detach();
      if (err.code === 'ENOENT') {
        reject(new CbmError('claude_not_found', `cannot run ${bin}: not found (set CBM_CLAUDE_BIN or put claude on PATH)`));
      } else {
        reject(err);
      }
    });
    child.on('exit', (code, signal) => {
      detach();
      resolve(code ?? 128 + (signal ? os.constants.signals[signal] : 0));
    });
  });
}

async function edit(args: string[]): Promise<void> {
  const { values, positionals } = parse(
    args,
    {
      name: { type: 'string' },
      'add-tag': { type: 'string', multiple: true },
      'rm-tag': { type: 'string', multiple: true },
      note: { type: 'string' },
    },
    { min: 1, max: 1 },
  );
  if (values.name === undefined && !values['add-tag'] && !values['rm-tag'] && values.note === undefined) {
    throw new CbmError('usage', 'edit needs at least one of --name, --add-tag, --rm-tag, --note');
  }
  const store = loadStore();
  const bookmark = resolveSelector(store, positionals[0]);
  if (values.name !== undefined) {
    const name = normalizeName(values.name);
    assertNameFree(store, name, bookmark.id);
    bookmark.name = name;
  }
  const removed = normalizeTags(values['rm-tag'] ?? []);
  bookmark.tags = normalizeTags([...bookmark.tags.filter((t) => !removed.includes(t)), ...(values['add-tag'] ?? [])]);
  if (values.note !== undefined) bookmark.note = values.note;
  saveStore(store);
  process.stdout.write(`Updated "${bookmark.name}" (${bookmark.id})\n`);
}

async function remove(args: string[]): Promise<void> {
  const { positionals } = parse(args, {}, { min: 1, max: 1 });
  const store = loadStore();
  const bookmark = resolveSelector(store, positionals[0]);
  store.bookmarks = store.bookmarks.filter((b) => b.id !== bookmark.id);
  saveStore(store);
  process.stdout.write(`Removed "${bookmark.name}" (${bookmark.id})\n`);
}

const COMMANDS: Record<string, (args: string[], out: Output) => Promise<void>> = { add, list, open, sessions, edit, remove };

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === undefined) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return;
  }
  // Until the command parses its flags, guess JSON mode from the args before any `--`.
  const dash = rest.indexOf('--');
  const flags = dash === -1 ? rest : rest.slice(0, dash);
  const out: Output = { json: (command === 'list' || command === 'sessions') && flags.includes('--json') };
  try {
    const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
    if (!run) throw new CbmError('usage', `unknown command "${command}"; run cbm --help`);
    await run(rest, out);
  } catch (err) {
    if (process.env.CBM_DEBUG && err instanceof Error) process.stderr.write(`${err.stack}\n`);
    const error = err instanceof CbmError ? err : new CbmError('internal', err instanceof Error ? err.message : String(err));
    if (out.json) {
      printJson({ ok: false, error: { code: error.code, message: error.message } });
    } else {
      process.stderr.write(`cbm: ${error.message}\n`);
    }
    process.exitCode = error.exitCode;
  }
}

await main(process.argv.slice(2));
