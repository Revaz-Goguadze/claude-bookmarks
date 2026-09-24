import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  UUID_A,
  UUID_B,
  UUID_UNKNOWN,
  addOk,
  makeProject,
  makeSandbox,
  run,
  writeSession,
} from './helpers.ts';

function fixture() {
  const sb = makeSandbox();
  const cwd = makeProject(sb, 'auth-service');
  writeSession(sb, { id: UUID_A, cwd, prompt: 'fix the auth refresh bug', timestamp: '2026-09-20T10:00:00.000Z' });
  writeSession(sb, { id: UUID_B, cwd, prompt: 'add retry to uploads', timestamp: '2026-09-20T11:00:00.000Z' });
  return sb;
}

function withBookmark() {
  const sb = fixture();
  addOk(sb, [UUID_A, '--name', 'Auth fix', '--tag', 'auth']);
  const before = fs.readFileSync(sb.store);
  return { sb, before };
}

describe('C3 add errors', () => {
  test('add not-a-uuid exits 2 and creates no store', () => {
    const sb = fixture();
    const r = run(sb, ['add', 'not-a-uuid']);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /^cbm: /m);
    assert.equal(fs.existsSync(sb.store), false);
  });

  test('add not-a-uuid with an existing store leaves it byte-identical', () => {
    const { sb, before } = withBookmark();
    const r = run(sb, ['add', 'not-a-uuid']);
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual(fs.readFileSync(sb.store), before);
  });

  test('add of an unknown session uuid exits 4 and creates no store', () => {
    const sb = fixture();
    const r = run(sb, ['add', UUID_UNKNOWN]);
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /^cbm: /m);
    assert.equal(fs.existsSync(sb.store), false);
  });

  test('add of an unknown session uuid with an existing store leaves it byte-identical', () => {
    const { sb, before } = withBookmark();
    const r = run(sb, ['add', UUID_UNKNOWN, '--name', 'Other']);
    assert.equal(r.status, 4, r.stderr);
    assert.deepEqual(fs.readFileSync(sb.store), before);
  });

  test('re-adding an already bookmarked session exits 6 and leaves the store byte-identical', () => {
    const { sb, before } = withBookmark();
    const r = run(sb, ['add', UUID_A, '--name', 'Different name']);
    assert.equal(r.status, 6, r.stderr);
    assert.match(r.stderr, /^cbm: /m);
    assert.deepEqual(fs.readFileSync(sb.store), before);
  });

  test('re-adding a bookmarked session given in uppercase exits 6', () => {
    const { sb, before } = withBookmark();
    const r = run(sb, ['add', UUID_A.toUpperCase(), '--name', 'Different name']);
    assert.equal(r.status, 6, r.stderr);
    assert.deepEqual(fs.readFileSync(sb.store), before);
  });

  test('a new session named AUTH FIX when Auth fix exists exits 6 and leaves the store byte-identical', () => {
    const { sb, before } = withBookmark();
    const r = run(sb, ['add', UUID_B, '--name', 'AUTH FIX']);
    assert.equal(r.status, 6, r.stderr);
    assert.match(r.stderr, /^cbm: /m);
    assert.deepEqual(fs.readFileSync(sb.store), before);
  });

  test('a name containing an ESC control char exits 2 and leaves the store byte-identical', () => {
    const { sb, before } = withBookmark();
    const r = run(sb, ['add', UUID_B, '--name', 'bad\u001bname']);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /^cbm: /m);
    assert.deepEqual(fs.readFileSync(sb.store), before);
  });

  test('a name containing an ESC control char on no store exits 2 and creates no store', () => {
    const sb = fixture();
    const r = run(sb, ['add', UUID_B, '--name', 'bad\u001bname']);
    assert.equal(r.status, 2, r.stderr);
    assert.equal(fs.existsSync(sb.store), false);
  });
});
