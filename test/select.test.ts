import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addOk,
  makeProject,
  makeSandbox,
  run,
  writeSession,
} from './helpers.ts';

const SHARED_1 = 'abcdef12-3456-4789-8abc-def012345601';
const SHARED_2 = 'abcdef12-9876-4543-9210-fedcba987602';
const UNIQUE = 'fedcba98-7654-4321-8fed-cba987654303';

function fixture() {
  const sb = makeSandbox();
  const cwd = makeProject(sb, 'mono');
  writeSession(sb, { id: SHARED_1, cwd, prompt: 'first shared', timestamp: '2026-09-20T10:00:00.000Z' });
  writeSession(sb, { id: SHARED_2, cwd, prompt: 'second shared', timestamp: '2026-09-20T11:00:00.000Z' });
  writeSession(sb, { id: UNIQUE, cwd, prompt: 'unique one', timestamp: '2026-09-20T12:00:00.000Z' });
  addOk(sb, [SHARED_1, '--name', 'Auth fix']);
  addOk(sb, [SHARED_2, '--name', 'Cache work']);
  addOk(sb, [UNIQUE, '--name', 'Docs pass']);
  return { sb, cwd };
}

function expectCommand(cwd: string, bin: string, uuid: string): string {
  return `cd '${cwd}' && '${bin}' --resume ${uuid}\n`;
}

describe('C10 select', () => {
  test('exact name in any case resolves to its uuid', () => {
    const { sb, cwd } = fixture();
    for (const sel of ['Auth fix', 'AUTH FIX', 'auth fix', 'aUtH fIx']) {
      const r = run(sb, ['open', sel, '--print-command']);
      assert.equal(r.status, 0, `${sel}: ${r.stderr}`);
      assert.equal(r.stdout, expectCommand(cwd, sb.fakeBin, SHARED_1), sel);
    }
  });

  test('full uuid resolves to that bookmark', () => {
    const { sb, cwd } = fixture();
    const r = run(sb, ['open', SHARED_2, '--print-command']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, expectCommand(cwd, sb.fakeBin, SHARED_2));
  });

  test('a unique 8-char uuid prefix resolves in either case', () => {
    const { sb, cwd } = fixture();
    for (const sel of ['fedcba98', 'FEDCBA98']) {
      const r = run(sb, ['open', sel, '--print-command']);
      assert.equal(r.status, 0, `${sel}: ${r.stderr}`);
      assert.equal(r.stdout, expectCommand(cwd, sb.fakeBin, UNIQUE), sel);
    }
  });

  test('an 8-char prefix shared by two bookmarks exits 2 listing both candidates and prints nothing on stdout', () => {
    const { sb } = fixture();
    const r = run(sb, ['open', 'abcdef12', '--print-command']);
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.includes(`Auth fix (${SHARED_1})`), r.stderr);
    assert.ok(r.stderr.includes(`Cache work (${SHARED_2})`), r.stderr);
    assert.equal(r.stderr.includes(UNIQUE), false, r.stderr);
  });

  test('a 7-char prefix exits 5', () => {
    const { sb } = fixture();
    const r = run(sb, ['open', 'fedcba9', '--print-command']);
    assert.equal(r.status, 5, r.stderr);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^cbm: /m);
  });

  test('an unknown name exits 5', () => {
    const { sb } = fixture();
    const r = run(sb, ['open', 'nosuch bookmark', '--print-command']);
    assert.equal(r.status, 5, r.stderr);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^cbm: /m);
  });
});
