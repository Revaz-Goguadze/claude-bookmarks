import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ISO_RE,
  UUID_A,
  UUID_B,
  makeProject,
  makeSandbox,
  readStore,
  run,
  writeSession,
} from './helpers.ts';

function fixture() {
  const sb = makeSandbox();
  const cwdA = makeProject(sb, 'auth-service');
  const cwdB = makeProject(sb, 'web-app');
  writeSession(sb, { id: UUID_A, cwd: cwdA, prompt: 'fix the auth refresh bug', timestamp: '2026-09-20T10:00:00.000Z' });
  writeSession(sb, { id: UUID_B, cwd: cwdB, prompt: 'fix the auth refresh bug', timestamp: '2026-09-20T11:00:00.000Z' });
  return { sb, cwdA, cwdB };
}

describe('C2 add', () => {
  test('add with uppercase uuid, name, tags and note stores one normalized record', () => {
    const { sb, cwdA } = fixture();
    const t0 = Date.now();
    const r = run(sb, ['add', UUID_A.toUpperCase(), '--name', 'Auth fix', '--tag', 'Auth', '--tag', '#urgent', '--note', 'check refresh']);
    const t1 = Date.now();
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('Auth fix'), `stdout must contain the name: ${r.stdout}`);
    assert.ok(r.stdout.includes(UUID_A), `stdout must contain the lowercase uuid: ${r.stdout}`);

    const store = readStore(sb);
    assert.equal(store.bookmarks.length, 1);
    const createdAt = store.bookmarks[0].createdAt;
    assert.match(createdAt, ISO_RE);
    assert.ok(Date.parse(createdAt) >= t0 && Date.parse(createdAt) <= t1, `createdAt ${createdAt} outside test window`);
    assert.deepEqual(store, {
      version: 1,
      bookmarks: [
        {
          id: UUID_A,
          name: 'Auth fix',
          tags: ['auth', 'urgent'],
          note: 'check refresh',
          cwd: cwdA,
          createdAt,
          lastOpenedAt: null,
        },
      ],
    });
  });

  test('store file is pretty-printed JSON with mode 0600 and the store dir holds no other file', () => {
    const { sb } = fixture();
    const r = run(sb, ['add', UUID_A, '--name', 'Auth fix']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.statSync(sb.store).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(sb.storeDir), ['bookmarks.json']);
    const text = fs.readFileSync(sb.store, 'utf8');
    assert.ok(text.includes('\n  '), 'store must be pretty-printed');
    assert.deepEqual(JSON.parse(text).version, 1);
  });

  test('add of a second session without --name stores the SDK summary as the name', () => {
    const { sb, cwdA, cwdB } = fixture();
    assert.equal(run(sb, ['add', UUID_A, '--name', 'Auth fix']).status, 0);
    const r = run(sb, ['add', UUID_B]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('fix the auth refresh bug'), r.stdout);
    assert.ok(r.stdout.includes(UUID_B), r.stdout);

    const store = readStore(sb);
    assert.equal(store.version, 1);
    const byId = new Map(store.bookmarks.map((b) => [b.id, b]));
    assert.equal(store.bookmarks.length, 2);
    const a = byId.get(UUID_A);
    const b = byId.get(UUID_B);
    assert.ok(a && b);
    assert.deepEqual(a, { id: UUID_A, name: 'Auth fix', tags: [], note: '', cwd: cwdA, createdAt: a.createdAt, lastOpenedAt: null });
    assert.deepEqual(b, { id: UUID_B, name: 'fix the auth refresh bug', tags: [], note: '', cwd: cwdB, createdAt: b.createdAt, lastOpenedAt: null });
    assert.match(b.createdAt, ISO_RE);
    assert.deepEqual(fs.readdirSync(sb.storeDir), ['bookmarks.json']);
  });
});
