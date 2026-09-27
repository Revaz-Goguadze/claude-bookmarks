import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ISO_RE,
  ROOT,
  UUID_A,
  addOk,
  appendTranscript,
  makeProject,
  makeSandbox,
  readFakeLog,
  readStore,
  run,
  writeSession,
  writeStore,
  type Sandbox,
  type StoreRecord,
  type TranscriptRecord,
} from './helpers.ts';

const U1 = '10000000-0000-4000-8000-000000000001';
const A2 = '10000000-0000-4000-8000-000000000002';
const U3 = '10000000-0000-4000-8000-000000000003';
const A4 = '10000000-0000-4000-8000-000000000004';
const U5 = '10000000-0000-4000-8000-000000000005';
const A6 = '10000000-0000-4000-8000-000000000006';
const U7 = '10000000-0000-4000-8000-000000000007';
const A8 = '10000000-0000-4000-8000-000000000008';
const ABSENT = '10000000-0000-4000-8000-0000000000ff';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME = 'SFT training';

const ROOT_MSGS: TranscriptRecord[] = [
  { type: 'user', uuid: U1, parentUuid: null, text: 'root prompt' },
  { type: 'assistant', uuid: A2, parentUuid: U1, text: 'root reply' },
];
const BRANCH_A: TranscriptRecord[] = [
  { type: 'user', uuid: U3, parentUuid: A2, text: 'A prompt' },
  { type: 'assistant', uuid: A4, parentUuid: U3, text: 'A reply' },
];
const BRANCH_B: TranscriptRecord[] = [
  { type: 'user', uuid: U5, parentUuid: A2, text: 'B prompt' },
  { type: 'assistant', uuid: A6, parentUuid: U5, text: 'B reply' },
];
const A_CONTINUED: TranscriptRecord[] = [
  { type: 'user', uuid: U7, parentUuid: A4, text: 'A2 prompt' },
  { type: 'assistant', uuid: A8, parentUuid: U7, text: 'A2 reply' },
];

interface Fx {
  sb: Sandbox;
  cwd: string;
  projDir: string;
  source: string;
}

function base(): Fx {
  const sb = makeSandbox();
  const cwd = makeProject(sb, 'lora-work');
  const source = appendTranscript(sb, { id: UUID_A, cwd }, [...ROOT_MSGS, ...BRANCH_A]);
  return { sb, cwd, projDir: path.dirname(source), source };
}

// Root, branch A bookmarked with cbm add, then branch B appended.
function twoBranch(): Fx {
  const fx = base();
  addOk(fx.sb, [UUID_A, '--name', NAME]);
  appendTranscript(fx.sb, { id: UUID_A, cwd: fx.cwd }, BRANCH_B);
  return fx;
}

function jsonlFiles(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
}

function onlyRecord(sb: Sandbox): StoreRecord {
  const s = readStore(sb);
  assert.equal(s.bookmarks.length, 1);
  return s.bookmarks[0];
}

function readJsonl(file: string): Array<Record<string, any>> {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l));
}

function isUA(r: Record<string, any>): boolean {
  return r.type === 'user' || r.type === 'assistant';
}

function textOf(r: Record<string, any>): string {
  const c = r.message?.content;
  if (typeof c === 'string') return c;
  return (c as Array<{ type: string; text?: string }>).filter((p) => p.type === 'text').map((p) => p.text).join('');
}

function newIdOf(fx: Fx): string {
  const files = jsonlFiles(fx.projDir).filter((f) => f !== `${UUID_A}.jsonl`);
  assert.equal(files.length, 1, `expected one copied session, got ${files.join(',')}`);
  return files[0].slice(0, -'.jsonl'.length);
}

function nullOpened(text: string): string {
  return text.replace(/"lastOpenedAt": (null|"[^"]*")/g, '"lastOpenedAt": null');
}

function handStore(sb: Sandbox, cwd: string, extra: Record<string, unknown>): string {
  const content =
    JSON.stringify(
      {
        version: 1,
        bookmarks: [
          {
            id: UUID_A,
            name: NAME,
            tags: [],
            note: '',
            cwd,
            createdAt: '2026-09-20T12:00:00.000Z',
            lastOpenedAt: null,
            ...extra,
          },
        ],
      },
      null,
      2,
    ) + '\n';
  writeStore(sb, content);
  return content;
}

describe('pin add', () => {
  test('B1 add on a writeSession fixture stores leafUuid a1 and list --json shows it', () => {
    const sb = makeSandbox();
    const cwd = makeProject(sb, 'auth-service');
    writeSession(sb, { id: UUID_A, cwd, prompt: 'fix the auth refresh bug', timestamp: '2026-09-20T10:00:00.000Z' });
    addOk(sb, [UUID_A, '--name', 'Auth fix']);
    const rec = onlyRecord(sb);
    assert.deepEqual(rec, {
      id: UUID_A,
      name: 'Auth fix',
      tags: [],
      note: '',
      cwd,
      createdAt: rec.createdAt,
      lastOpenedAt: null,
      leafUuid: 'a1',
    });
    assert.match(rec.createdAt, ISO_RE);
    const r = run(sb, ['list', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const parsed = JSON.parse(r.stdout) as { data: { bookmarks: Array<Record<string, unknown>> } };
    assert.equal(parsed.data.bookmarks.length, 1);
    assert.equal(parsed.data.bookmarks[0].leafUuid, 'a1');
  });

  test('B2 add on a file with branch A then branch B pins the last message of branch B', () => {
    const fx = base();
    appendTranscript(fx.sb, { id: UUID_A, cwd: fx.cwd }, BRANCH_B);
    addOk(fx.sb, [UUID_A, '--name', NAME]);
    assert.equal(onlyRecord(fx.sb).leafUuid, A6);
  });
});

describe('pin open current branch', () => {
  test('B3 a record without leafUuid resumes id, copies nothing and keeps the key absent', () => {
    const fx = base();
    appendTranscript(fx.sb, { id: UUID_A, cwd: fx.cwd }, BRANCH_B);
    handStore(fx.sb, fx.cwd, {});
    const before = onlyRecord(fx.sb);
    const r = run(fx.sb, ['open', NAME]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readFakeLog(fx.sb), { argv: ['--resume', UUID_A], cwd: fx.cwd });
    assert.deepEqual(jsonlFiles(fx.projDir), [`${UUID_A}.jsonl`]);
    const after = onlyRecord(fx.sb);
    assert.equal('leafUuid' in after, false);
    assert.match(after.lastOpenedAt as string, ISO_RE);
    assert.deepEqual({ ...after, lastOpenedAt: null }, before);
  });

  test('B4 pin at a4 with a continuation under a4 resumes id and leaves id and leafUuid unchanged', () => {
    const fx = base();
    addOk(fx.sb, [UUID_A, '--name', NAME]);
    assert.equal(onlyRecord(fx.sb).leafUuid, A4);
    appendTranscript(fx.sb, { id: UUID_A, cwd: fx.cwd }, A_CONTINUED);
    const r = run(fx.sb, ['open', NAME]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readFakeLog(fx.sb), { argv: ['--resume', UUID_A], cwd: fx.cwd });
    assert.deepEqual(jsonlFiles(fx.projDir), [`${UUID_A}.jsonl`]);
    const after = onlyRecord(fx.sb);
    assert.equal(after.id, UUID_A);
    assert.equal(after.leafUuid, A4);
  });
});

describe('pin open stale branch', () => {
  test('B5 two-branch open copies the pinned branch to a new session and resumes it', () => {
    const fx = twoBranch();
    assert.equal(onlyRecord(fx.sb).leafUuid, A4);
    const sourceBytes = fs.readFileSync(fx.source);
    const r = run(fx.sb, ['open', NAME], { env: { FAKE_EXIT: '7' } });
    assert.equal(r.status, 7, r.stderr);
    const newId = newIdOf(fx);
    assert.match(newId, UUID_RE);
    assert.notEqual(newId, UUID_A);
    assert.deepEqual(jsonlFiles(fx.projDir), [`${UUID_A}.jsonl`, `${newId}.jsonl`].sort());
    assert.deepEqual(readFakeLog(fx.sb), { argv: ['--resume', newId], cwd: fx.cwd });
    assert.ok(fs.readFileSync(fx.source).equals(sourceBytes), 'source transcript must be byte-identical');
  });

  test('B6 the copied file carries newId, the A branch texts, forkedFrom a4, the bookmark title and mode 0600', () => {
    const fx = twoBranch();
    const r = run(fx.sb, ['open', NAME]);
    assert.equal(r.status, 0, r.stderr);
    const newId = newIdOf(fx);
    const file = path.join(fx.projDir, `${newId}.jsonl`);
    const recs = readJsonl(file);
    const ua = recs.filter(isUA);
    assert.ok(ua.length > 0);
    for (const rec of ua) assert.equal(rec.sessionId, newId);
    for (const rec of recs) if ('sessionId' in rec) assert.equal(rec.sessionId, newId);
    assert.deepEqual(ua.map(textOf), ['root prompt', 'root reply', 'A prompt', 'A reply']);
    assert.deepEqual(ua[ua.length - 1].forkedFrom, { sessionId: UUID_A, messageUuid: A4 });
    const titles = recs.filter((x) => x.type === 'custom-title');
    assert.ok(titles.length >= 1, 'custom-title record missing');
    assert.equal(titles[titles.length - 1].customTitle, NAME);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  test('B7 the record is repointed to newId with the copy leaf and a fresh lastOpenedAt, stderr names both ids', () => {
    const fx = twoBranch();
    const before = onlyRecord(fx.sb);
    const t0 = Date.now();
    const r = run(fx.sb, ['open', NAME]);
    const t1 = Date.now();
    assert.equal(r.status, 0, r.stderr);
    const newId = newIdOf(fx);
    const ua = readJsonl(path.join(fx.projDir, `${newId}.jsonl`)).filter(isUA);
    const after = onlyRecord(fx.sb);
    assert.match(after.lastOpenedAt as string, ISO_RE);
    const ms = Date.parse(after.lastOpenedAt as string);
    assert.ok(ms >= t0 && ms <= t1, `lastOpenedAt ${after.lastOpenedAt} outside test window`);
    assert.deepEqual(after, { ...before, id: newId, leafUuid: ua[ua.length - 1].uuid, lastOpenedAt: after.lastOpenedAt });
    assert.ok(r.stderr.includes(UUID_A), r.stderr);
    assert.ok(r.stderr.includes(newId), r.stderr);
  });

  test('B8 a second open resumes newId without another copy', () => {
    const fx = twoBranch();
    assert.equal(run(fx.sb, ['open', NAME]).status, 0);
    const newId = newIdOf(fx);
    fs.rmSync(fx.sb.fakeLog);
    const r = run(fx.sb, ['open', NAME]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readFakeLog(fx.sb), { argv: ['--resume', newId], cwd: fx.cwd });
    assert.equal(jsonlFiles(fx.projDir).length, 2);
    assert.equal(onlyRecord(fx.sb).id, newId);
  });

  test('B9 a pin with a continuation under it and a later branch B copies up to the newest descendant a8', () => {
    const fx = base();
    addOk(fx.sb, [UUID_A, '--name', NAME]);
    appendTranscript(fx.sb, { id: UUID_A, cwd: fx.cwd }, [...A_CONTINUED, ...BRANCH_B]);
    const r = run(fx.sb, ['open', NAME]);
    assert.equal(r.status, 0, r.stderr);
    const newId = newIdOf(fx);
    const ua = readJsonl(path.join(fx.projDir, `${newId}.jsonl`)).filter(isUA);
    assert.equal(ua[ua.length - 1].forkedFrom?.messageUuid, A8);
    const texts = ua.map(textOf);
    for (const t of ['A prompt', 'A reply', 'A2 prompt', 'A2 reply']) assert.ok(texts.includes(t), `missing ${t}: ${texts}`);
  });

  test('B10 --print-command copies, repoints and prints the newId line, and repeats without a third copy', () => {
    const fx = twoBranch();
    const r = run(fx.sb, ['open', NAME, '--print-command']);
    assert.equal(r.status, 0, r.stderr);
    const newId = newIdOf(fx);
    const line = `cd '${fx.cwd}' && '${fx.sb.fakeBin}' --resume ${newId}\n`;
    assert.equal(r.stdout, line);
    assert.equal(fs.existsSync(fx.sb.fakeLog), false, 'fake claude must not run');
    const rec = onlyRecord(fx.sb);
    assert.equal(rec.id, newId);
    assert.equal(rec.lastOpenedAt, null);
    const r2 = run(fx.sb, ['open', NAME, '--print-command']);
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(r2.stdout, line);
    assert.equal(jsonlFiles(fx.projDir).length, 2);
  });

  test('B11 --fork on a stale pin runs --resume newId --fork-session', () => {
    const fx = twoBranch();
    const r = run(fx.sb, ['open', NAME, '--fork']);
    assert.equal(r.status, 0, r.stderr);
    const newId = newIdOf(fx);
    assert.deepEqual(readFakeLog(fx.sb), { argv: ['--resume', newId, '--fork-session'], cwd: fx.cwd });
  });
});

describe('pin open edge cases', () => {
  test('B12 a pin absent from the file warns and resumes id without copying', () => {
    const fx = base();
    appendTranscript(fx.sb, { id: UUID_A, cwd: fx.cwd }, BRANCH_B);
    const storeText = handStore(fx.sb, fx.cwd, { leafUuid: ABSENT });
    const r = run(fx.sb, ['open', NAME]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stderr.includes('warning'), r.stderr);
    assert.deepEqual(readFakeLog(fx.sb), { argv: ['--resume', UUID_A], cwd: fx.cwd });
    assert.deepEqual(jsonlFiles(fx.projDir), [`${UUID_A}.jsonl`]);
    const after = fs.readFileSync(fx.sb.store, 'utf8');
    assert.match(onlyRecord(fx.sb).lastOpenedAt as string, ISO_RE);
    assert.equal(nullOpened(after), storeText);
  });

  test('B13 a removed bookmark cwd exits 3 before any copy and leaves the store byte-identical', () => {
    const fx = twoBranch();
    const storeBytes = fs.readFileSync(fx.sb.store);
    fs.rmSync(fx.cwd, { recursive: true });
    const r = run(fx.sb, ['open', NAME]);
    assert.equal(r.status, 3, r.stderr);
    assert.deepEqual(jsonlFiles(fx.projDir), [`${UUID_A}.jsonl`]);
    assert.ok(fs.readFileSync(fx.sb.store).equals(storeBytes), 'store must be byte-identical');
  });

  test('B14 a failed copy exits 1 with a cbm error, runs nothing and writes nothing', (t) => {
    if (process.getuid?.() === 0) {
      t.skip('root ignores directory write permissions');
      return;
    }
    const fx = twoBranch();
    const storeBytes = fs.readFileSync(fx.sb.store);
    fs.chmodSync(fx.projDir, 0o555);
    try {
      const r = run(fx.sb, ['open', NAME]);
      assert.equal(r.status, 1, r.stderr);
      assert.ok(r.stderr.startsWith('cbm: '), r.stderr);
      assert.equal(fs.existsSync(fx.sb.fakeLog), false, 'fake claude must not run');
      assert.deepEqual(jsonlFiles(fx.projDir), [`${UUID_A}.jsonl`]);
      assert.ok(fs.readFileSync(fx.sb.store).equals(storeBytes), 'store must be byte-identical');
    } finally {
      fs.chmodSync(fx.projDir, 0o755);
    }
  });

  test('B15 a non-string leafUuid is a corrupt store and the file is untouched', () => {
    const fx = base();
    const storeText = handStore(fx.sb, fx.cwd, { leafUuid: 5 });
    const r = run(fx.sb, ['list']);
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.includes('store'), r.stderr);
    assert.equal(fs.readFileSync(fx.sb.store, 'utf8'), storeText);
  });

  test('B16 README documents the leafUuid store field', () => {
    assert.ok(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').includes('leafUuid'));
  });
});
