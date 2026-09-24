import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { UUID_A, UUID_B, makeProject, makeSandbox, readStore, run, writeSession } from './helpers.ts';

describe('R1 default name', () => {
  test('a session whose summary is a slash command gets "session <id prefix>" instead', () => {
    const sb = makeSandbox();
    const cwd = makeProject(sb, 'app');
    writeSession(sb, { id: UUID_A, cwd, prompt: '/session-bookmarks:bookmarks', timestamp: '2026-09-20T10:00:00.000Z' });
    const r = run(sb, ['add', UUID_A]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readStore(sb).bookmarks[0].name, `session ${UUID_A.slice(0, 8)}`);
  });

  test('a normal prompt summary is still used as the name', () => {
    const sb = makeSandbox();
    const cwd = makeProject(sb, 'app');
    writeSession(sb, { id: UUID_B, cwd, prompt: 'fix the auth refresh bug', timestamp: '2026-09-20T10:00:00.000Z' });
    const r = run(sb, ['add', UUID_B]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readStore(sb).bookmarks[0].name, 'fix the auth refresh bug');
  });
});
