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
  run,
  writeSession,
} from './helpers.ts';

function fixture() {
  const sb = makeSandbox();
  const cwd = makeProject(sb, 'auth-service');
  const fileA = writeSession(sb, { id: UUID_A, cwd, prompt: 'fix the auth refresh bug', timestamp: '2026-09-20T10:00:00.000Z' });
  writeSession(sb, { id: UUID_B, cwd, prompt: 'write docs for install', timestamp: '2026-09-20T11:00:00.000Z' });
  addOk(sb, [UUID_A, '--name', 'Auth fix', '--tag', 'auth']);
  addOk(sb, [UUID_B, '--name', 'Docs pass']);
  return { sb, fileA };
}

describe('C13 remove', () => {
  test('remove "auth fix" drops only that record and leaves its .jsonl byte-identical', () => {
    const { sb, fileA } = fixture();
    const jsonlBefore = fs.readFileSync(fileA);
    const storeBefore = readStore(sb);
    const r = run(sb, ['remove', 'auth fix']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('Auth fix'), `stdout must contain the removed name: ${r.stdout}`);
    assert.deepEqual(readStore(sb), {
      version: 1,
      bookmarks: storeBefore.bookmarks.filter((b) => b.id !== UUID_A),
    });
    assert.equal(readStore(sb).bookmarks.length, 1);
    assert.deepEqual(fs.readFileSync(fileA), jsonlBefore);
  });

  test('remove nosuch exits 5 and leaves the store byte-identical', () => {
    const { sb } = fixture();
    const storeBefore = fs.readFileSync(sb.store);
    const r = run(sb, ['remove', 'nosuch']);
    assert.equal(r.status, 5, r.stderr);
    assert.match(r.stderr, /^cbm: /m);
    assert.equal(r.stdout, '');
    assert.deepEqual(fs.readFileSync(sb.store), storeBefore);
  });
});
