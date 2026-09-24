import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  UUID_A,
  UUID_B,
  addOk,
  makeProject,
  makeSandbox,
  readStore,
  record,
  run,
  writeSession,
} from './helpers.ts';

function fixture() {
  const sb = makeSandbox();
  const cwd = makeProject(sb, 'auth-service');
  const files = [
    writeSession(sb, { id: UUID_A, cwd, prompt: 'fix the auth refresh bug', timestamp: '2026-09-20T10:00:00.000Z' }),
    writeSession(sb, { id: UUID_B, cwd, prompt: 'write docs for install', timestamp: '2026-09-20T11:00:00.000Z' }),
  ];
  addOk(sb, [UUID_A, '--name', 'Auth fix', '--tag', 'auth', '--tag', 'urgent', '--note', 'check refresh']);
  addOk(sb, [UUID_B, '--name', 'Docs pass']);
  const jsonl = files.map((f) => fs.readFileSync(f));
  const assertJsonlUnchanged = () => {
    files.forEach((f, i) => assert.deepEqual(fs.readFileSync(f), jsonl[i], `${f} changed`));
  };
  return { sb, assertJsonlUnchanged };
}

describe('C12 edit', () => {
  test('--name renames the bookmark', () => {
    const { sb, assertJsonlUnchanged } = fixture();
    const before = record(sb, UUID_A);
    const r = run(sb, ['edit', 'Auth fix', '--name', 'Auth refresh fix']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(record(sb, UUID_A), { ...before, name: 'Auth refresh fix' });
    assertJsonlUnchanged();
  });

  test('--add-tag "#New" adds the normalized tag new', () => {
    const { sb, assertJsonlUnchanged } = fixture();
    const before = record(sb, UUID_A);
    const r = run(sb, ['edit', 'auth fix', '--add-tag', '#New']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(record(sb, UUID_A), { ...before, tags: ['auth', 'urgent', 'new'] });
    assertJsonlUnchanged();
  });

  test('--rm-tag auth removes that tag', () => {
    const { sb, assertJsonlUnchanged } = fixture();
    const before = record(sb, UUID_A);
    const r = run(sb, ['edit', 'Auth fix', '--rm-tag', 'auth']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(record(sb, UUID_A), { ...before, tags: ['urgent'] });
    assertJsonlUnchanged();
  });

  test('--note "" clears the note', () => {
    const { sb, assertJsonlUnchanged } = fixture();
    const before = record(sb, UUID_A);
    const r = run(sb, ['edit', 'Auth fix', '--note', '']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(record(sb, UUID_A), { ...before, note: '' });
    assertJsonlUnchanged();
  });

  test('renaming onto another bookmark name in other case exits 6 and leaves the store byte-identical', () => {
    const { sb, assertJsonlUnchanged } = fixture();
    const storeBefore = fs.readFileSync(sb.store);
    const r = run(sb, ['edit', 'Docs pass', '--name', 'AUTH FIX']);
    assert.equal(r.status, 6, r.stderr);
    assert.match(r.stderr, /^cbm: /m);
    assert.deepEqual(fs.readFileSync(sb.store), storeBefore);
    assertJsonlUnchanged();
  });

  test('edit with no change flag exits 2 and leaves the store byte-identical', () => {
    const { sb, assertJsonlUnchanged } = fixture();
    const storeBefore = fs.readFileSync(sb.store);
    const r = run(sb, ['edit', 'Auth fix']);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /^cbm: /m);
    assert.deepEqual(fs.readFileSync(sb.store), storeBefore);
    assertJsonlUnchanged();
  });

  test('edit leaves the other bookmark untouched', () => {
    const { sb } = fixture();
    const other = record(sb, UUID_B);
    const r = run(sb, ['edit', 'Auth fix', '--name', 'Renamed', '--add-tag', 'x', '--note', 'n']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(record(sb, UUID_B), other);
    assert.equal(readStore(sb).bookmarks.length, 2);
  });
});
