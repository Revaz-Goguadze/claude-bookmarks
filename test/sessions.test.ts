import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UUID_A,
  UUID_B,
  UUID_C,
  addOk,
  escapeRe,
  hoursAgoIso,
  makeProject,
  makeSandbox,
  run,
  writeSession,
} from './helpers.ts';

function fixture() {
  const sb = makeSandbox();
  const cwdA = makeProject(sb, 'auth-service');
  const cwdB = makeProject(sb, 'uploader');
  const t1 = hoursAgoIso(3);
  const t2 = hoursAgoIso(2);
  const t3 = hoursAgoIso(1);
  writeSession(sb, { id: UUID_A, cwd: cwdA, prompt: 'fix the auth refresh bug', timestamp: t1 });
  writeSession(sb, { id: UUID_B, cwd: cwdA, prompt: 'write docs for install', timestamp: t2 });
  writeSession(sb, { id: UUID_C, cwd: cwdB, prompt: 'add retry to uploads', timestamp: t3 });
  addOk(sb, [UUID_A, '--name', 'Auth fix']);
  return { sb, cwdA, cwdB, t1, t2, t3 };
}

function parseOneLine(stdout: string): unknown {
  assert.ok(stdout.endsWith('\n'), 'json output must end with a newline');
  const body = stdout.slice(0, -1);
  assert.equal(body.includes('\n'), false, `json output must be one line: ${stdout}`);
  return JSON.parse(body);
}

describe('C11 sessions', () => {
  test('sessions --json lists all sessions newest first with documented fields and bookmark info', () => {
    const { sb, cwdA, cwdB, t1, t2, t3 } = fixture();
    const r = run(sb, ['sessions', '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(parseOneLine(r.stdout), {
      ok: true,
      data: {
        sessions: [
          {
            sessionId: UUID_C,
            summary: 'add retry to uploads',
            customTitle: null,
            cwd: cwdB,
            gitBranch: null,
            lastModified: Date.parse(t3),
            bookmarked: false,
            bookmarkName: null,
          },
          {
            sessionId: UUID_B,
            summary: 'write docs for install',
            customTitle: null,
            cwd: cwdA,
            gitBranch: null,
            lastModified: Date.parse(t2),
            bookmarked: false,
            bookmarkName: null,
          },
          {
            sessionId: UUID_A,
            summary: 'fix the auth refresh bug',
            customTitle: null,
            cwd: cwdA,
            gitBranch: null,
            lastModified: Date.parse(t1),
            bookmarked: true,
            bookmarkName: 'Auth fix',
          },
        ],
      },
    });
  });

  test('query refresh filters sessions by summary', () => {
    const { sb } = fixture();
    const r = run(sb, ['sessions', 'refresh', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const parsed = parseOneLine(r.stdout) as { data: { sessions: Array<{ sessionId: string }> } };
    assert.deepEqual(parsed.data.sessions.map((s) => s.sessionId), [UUID_A]);

    const human = run(sb, ['sessions', 'refresh']);
    assert.equal(human.status, 0, human.stderr);
    const lines = human.stdout.split('\n').filter((l) => l.trim() !== '');
    assert.equal(lines.length, 1, human.stdout);
    assert.ok(lines[0].startsWith(`${UUID_A}  `), human.stdout);
  });

  test('--limit 1 returns only the newest session', () => {
    const { sb } = fixture();
    const r = run(sb, ['sessions', '--limit', '1', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const parsed = parseOneLine(r.stdout) as { ok: boolean; data: { sessions: Array<{ sessionId: string }> } };
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.data.sessions.map((s) => s.sessionId), [UUID_C]);
  });

  test('human output shows [bookmarked: Auth fix] only on the bookmarked session line', () => {
    const { sb, cwdA, cwdB } = fixture();
    const r = run(sb, ['sessions']);
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split('\n').filter((l) => l.trim() !== '');
    assert.equal(lines.length, 3, r.stdout);
    assert.match(lines[0], new RegExp(`^${UUID_C}  add retry to uploads  1h ago  ${escapeRe(cwdB)}$`));
    assert.match(lines[1], new RegExp(`^${UUID_B}  write docs for install  2h ago  ${escapeRe(cwdA)}$`));
    assert.match(lines[2], new RegExp(`^${UUID_A}  fix the auth refresh bug  3h ago  ${escapeRe(cwdA)}\\s+\\[bookmarked: Auth fix\\]$`));
  });

  for (const bad of ['0', 'abc']) {
    test(`--limit ${bad} is a usage error exiting 2`, () => {
      const { sb } = fixture();
      const r = run(sb, ['sessions', '--limit', bad]);
      assert.equal(r.status, 2, r.stderr);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /^cbm: /m);
    });
  }
});
