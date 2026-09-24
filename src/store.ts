import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CbmError } from './errors.ts';

export interface Bookmark {
  id: string;
  name: string;
  tags: string[];
  note: string;
  cwd: string;
  createdAt: string;
  lastOpenedAt: string | null;
}

export interface Store {
  version: 1;
  bookmarks: Bookmark[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const MAX_NAME = 120;

function storePath(): string {
  if (process.env.CBM_STORE) return process.env.CBM_STORE;
  if (process.env.CLAUDE_CONFIG_DIR) return path.join(process.env.CLAUDE_CONFIG_DIR, 'bookmarks.json');
  return path.join(os.homedir(), '.claude', 'bookmarks.json');
}

function isBookmark(value: unknown): value is Bookmark {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const keys = Object.keys(r).sort().join(',');
  return (
    keys === 'createdAt,cwd,id,lastOpenedAt,name,note,tags' &&
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    Array.isArray(r.tags) &&
    r.tags.every((t) => typeof t === 'string') &&
    typeof r.note === 'string' &&
    typeof r.cwd === 'string' &&
    typeof r.createdAt === 'string' &&
    (r.lastOpenedAt === null || typeof r.lastOpenedAt === 'string')
  );
}

// A missing store reads as empty and is not created; a store that fails to parse is never overwritten.
export function loadStore(): Store {
  const file = storePath();
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, bookmarks: [] };
    throw err;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CbmError('store_corrupt', `bookmark store ${file} is not valid JSON; fix or move it aside`);
  }
  const store = data as { version?: unknown; bookmarks?: unknown };
  if (typeof data !== 'object' || data === null || store.version !== 1 || !Array.isArray(store.bookmarks)) {
    throw new CbmError('store_corrupt', `bookmark store ${file} is not a version 1 store; fix or move it aside`);
  }
  const bad = store.bookmarks.findIndex((b) => !isBookmark(b));
  if (bad !== -1) {
    throw new CbmError('store_corrupt', `bookmark store ${file} has a malformed record at index ${bad}; fix or move it aside`);
  }
  return data as Store;
}

// Writes a temp file next to the real store (following a symlinked store path), fsyncs it, then renames over.
export function saveStore(store: Store): void {
  const link = storePath();
  const file = fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() ? fs.realpathSync(link) : link;
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(store, null, 2) + '\n');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

export function normalizeSessionId(raw: string): string {
  if (!UUID_RE.test(raw)) throw new CbmError('invalid_session_id', `not a session UUID: ${raw}`);
  return raw.toLowerCase();
}

export function normalizeName(raw: string): string {
  const name = raw.trim();
  if (name === '' || name.length > MAX_NAME) {
    throw new CbmError('invalid_name', `bookmark name must be 1 to ${MAX_NAME} characters`);
  }
  if (CONTROL_RE.test(name)) throw new CbmError('invalid_name', 'bookmark name must not contain control characters');
  return name;
}

export function normalizeTags(raw: string[]): string[] {
  const tags: string[] = [];
  for (const t of raw) {
    const tag = t.trim().replace(/^#/, '').toLowerCase();
    if (tag !== '' && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

export function assertNameFree(store: Store, name: string, exceptId?: string): void {
  const clash = store.bookmarks.find((b) => b.id !== exceptId && b.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new CbmError('duplicate_name', `a bookmark named "${clash.name}" already exists (${clash.id})`);
}

// Exact name (any case), then full uuid, then a uuid prefix of at least 8 chars matching one bookmark.
export function resolveSelector(store: Store, selector: string): Bookmark {
  const sel = selector.toLowerCase();
  const byName = store.bookmarks.find((b) => b.name.toLowerCase() === sel);
  if (byName) return byName;
  const byId = store.bookmarks.find((b) => b.id === sel);
  if (byId) return byId;
  if (sel.length >= 8) {
    const matches = store.bookmarks.filter((b) => b.id.startsWith(sel));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const list = matches.map((b) => `  ${b.name} (${b.id})`).join('\n');
      throw new CbmError('ambiguous', `"${selector}" matches several bookmarks:\n${list}`);
    }
  }
  throw new CbmError('not_found', `no bookmark matches "${selector}"`);
}
