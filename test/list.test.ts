import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UUID_A,
  UUID_B,
  UUID_C,
  UUID_D,
  UUID_E,
  addOk,
  escapeRe,
  makeProject,
  makeSandbox,
  run,
  sleep,
  writeSession,
  writeStore,
} from './helpers.ts';
import type { Sandbox } from './helpers.ts';

function lines(stdout: string): string[] {
  return stdout.split('\n').filter((l) => l.trim() !== '');
}

function names(stdout: string): string[] {
  return lines(stdout).map((l) => l.split('  ')[0]);
}

function threeBookmarks(): { sb: Sandbox; cwds: Record<string, string> } {
  const sb = makeSandbox();
  const cwds = {
    a: makeProject(sb, 'auth-service'),
    b: makeProject(sb, 'docs-site'),
    c: makeProject(sb, 'uploader'),
  };
  writeSession(sb, { id: UUID_A, cwd: cwds.a, prompt: 'fix the auth refresh bug', timestamp: '2026-09-20T10:00:00.000Z' });
  writeSession(sb, { id: UUID_B, cwd: cwds.b, prompt: 'write docs for install', timestamp: '2026-09-20T11:00:00.000Z' });
  writeSession(sb, { id: UUID_C, cwd: cwds.c, prompt: 'add retry to uploads', timestamp: '2026-09-20T12:00:00.000Z' });
  addOk(sb, [UUID_A, '--name', 'Auth fix', '--tag', 'auth', '--tag', 'urgent']);
  addOk(sb, [UUID_B, '--name', 'Docs pass', '--tag', 'docs']);
  addOk(sb, [UUID_C, '--name', 'Upload retry']);
  return { sb, cwds };
}

describe('C5 list', () => {
  test('each line shows name, [tags], ready, age and cwd', () => {
    const { sb, cwds } = threeBookmarks();
    const r = run(sb, ['list']);
    assert.equal(r.status, 0, r.stderr);
    const out = lines(r.stdout);
    assert.equal(out.length, 3, r.stdout);
    const age = '(just now|\\d+m ago)';
    const expected = [
      ['Upload retry', '[]', cwds.c],
      ['Docs pass', '[docs]', cwds.b],
      ['Auth fix', '[auth, urgent]', cwds.a],
    ];
    expected.forEach(([name, tags, cwd], i) => {
      assert.match(out[i], new RegExp(`^${escapeRe(name)}  ${escapeRe(tags)}  ready  ${age}  ${escapeRe(cwd)}$`));
    });
  });

  test('query REFRESH matches by summary, tag, note word and name case-insensitively', () => {
    const sb = makeSandbox();
    const cwd = makeProject(sb, 'mono');
    writeSession(sb, { id: UUID_A, cwd, prompt: 'fix the auth refresh bug', timestamp: '2026-09-20T10:00:00.000Z' });
    writeSession(sb, { id: UUID_B, cwd, prompt: 'tune the database', timestamp: '2026-09-20T11:00:00.000Z' });
    writeSession(sb, { id: UUID_C, cwd, prompt: 'clean up css', timestamp: '2026-09-20T12:00:00.000Z' });
    writeSession(sb, { id: UUID_D, cwd, prompt: 'write docs', timestamp: '2026-09-20T13:00:00.000Z' });
    writeSession(sb, { id: UUID_E, cwd, prompt: 'add retry to uploads', timestamp: '2026-09-20T14:00:00.000Z' });
    addOk(sb, [UUID_A, '--name', 'Alpha']);
    addOk(sb, [UUID_B, '--name', 'Beta', '--tag', 'refresh']);
    addOk(sb, [UUID_C, '--name', 'Gamma', '--note', 'needs a refresh soon']);
    addOk(sb, [UUID_D, '--name', 'Refresh tokens']);
    addOk(sb, [UUID_E, '--name', 'Omega', '--tag', 'misc', '--note', 'nothing here']);

    const r = run(sb, ['list', 'REFRESH']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(names(r.stdout).sort(), ['Alpha', 'Beta', 'Gamma', 'Refresh tokens']);
  });

  test('--tag filters to bookmarks carrying that tag', () => {
    const { sb } = threeBookmarks();
    const r = run(sb, ['list', '--tag', 'urgent']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(names(r.stdout), ['Auth fix']);

    const r2 = run(sb, ['list', '--tag', 'docs']);
    assert.equal(r2.status, 0, r2.stderr);
    assert.deepEqual(names(r2.stdout), ['Docs pass']);
  });

  test('order is by max(lastOpenedAt, createdAt) descending', () => {
    const sb = makeSandbox();
    const cwd = makeProject(sb, 'mono');
    writeSession(sb, { id: UUID_A, cwd, prompt: 'first task', timestamp: '2026-09-20T10:00:00.000Z' });
    writeSession(sb, { id: UUID_B, cwd, prompt: 'second task', timestamp: '2026-09-20T11:00:00.000Z' });
    writeSession(sb, { id: UUID_C, cwd, prompt: 'third task', timestamp: '2026-09-20T12:00:00.000Z' });

    addOk(sb, [UUID_A, '--name', 'Older']);
    sleep(30);
    addOk(sb, [UUID_B, '--name', 'Newer']);
    let r = run(sb, ['list']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(names(r.stdout), ['Newer', 'Older']);

    sleep(30);
    const open = run(sb, ['open', 'Older']);
    assert.equal(open.status, 0, open.stderr);
    r = run(sb, ['list']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(names(r.stdout), ['Older', 'Newer']);

    sleep(30);
    addOk(sb, [UUID_C, '--name', 'Latest']);
    r = run(sb, ['list']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(names(r.stdout), ['Latest', 'Older', 'Newer']);
  });

  test('no store prints a hint containing cbm add', () => {
    const sb = makeSandbox();
    const r = run(sb, ['list']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('cbm add'), `stdout: ${r.stdout}`);
  });

  test('an empty store prints a hint containing cbm add', () => {
    const sb = makeSandbox();
    writeStore(sb, '{"version":1,"bookmarks":[]}');
    const r = run(sb, ['list']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('cbm add'), `stdout: ${r.stdout}`);
  });
});
