import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  UUID_A,
  UUID_B,
  addOk,
  escapeRe,
  makeProject,
  makeSandbox,
  readStore,
  record,
  run,
  writeSession,
} from './helpers.ts';

function fixture() {
  const sb = makeSandbox();
  const cwdA = makeProject(sb, 'auth-service');
  const cwdB = makeProject(sb, 'docs-site');
  writeSession(sb, { id: UUID_A, cwd: cwdA, prompt: 'fix the auth refresh bug', timestamp: '2026-09-20T10:00:00.000Z' });
  const fileB = writeSession(sb, { id: UUID_B, cwd: cwdB, prompt: 'write docs for install', timestamp: '2026-09-20T11:00:00.000Z' });
  addOk(sb, [UUID_A, '--name', 'Auth fix', '--tag', 'auth', '--note', 'check refresh']);
  addOk(sb, [UUID_B, '--name', 'Docs pass', '--tag', 'docs']);
  return { sb, cwdA, cwdB, fileB };
}

function parseOneLine(stdout: string): unknown {
  assert.ok(stdout.endsWith('\n'), 'json output must end with a newline');
  const body = stdout.slice(0, -1);
  assert.equal(body.includes('\n'), false, `json output must be one line: ${stdout}`);
  return JSON.parse(body);
}

describe('C6 list json', () => {
  test('list --json returns ok:true with every documented bookmark field', () => {
    const { sb, cwdA, cwdB } = fixture();
    const a = record(sb, UUID_A);
    const b = record(sb, UUID_B);
    const r = run(sb, ['list', '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(parseOneLine(r.stdout), {
      ok: true,
      data: {
        bookmarks: [
          {
            id: UUID_B,
            name: 'Docs pass',
            tags: ['docs'],
            note: '',
            cwd: cwdB,
            createdAt: b.createdAt,
            lastOpenedAt: null,
            status: 'ready',
            summary: 'write docs for install',
          },
          {
            id: UUID_A,
            name: 'Auth fix',
            tags: ['auth'],
            note: 'check refresh',
            cwd: cwdA,
            createdAt: a.createdAt,
            lastOpenedAt: null,
            status: 'ready',
            summary: 'fix the auth refresh bug',
          },
        ],
      },
    });
  });

  test('a bookmark whose session .jsonl was deleted shows missing with null summary and stays in the store', () => {
    const { sb, cwdB, fileB } = fixture();
    const storeBefore = readStore(sb);
    fs.rmSync(fileB);

    const r = run(sb, ['list', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const parsed = parseOneLine(r.stdout) as { ok: boolean; data: { bookmarks: Array<Record<string, unknown>> } };
    assert.equal(parsed.ok, true);
    const byId = new Map(parsed.data.bookmarks.map((b) => [b.id, b]));
    assert.deepEqual(byId.get(UUID_B), {
      id: UUID_B,
      name: 'Docs pass',
      tags: ['docs'],
      note: '',
      cwd: cwdB,
      createdAt: record(sb, UUID_B).createdAt,
      lastOpenedAt: null,
      status: 'missing',
      summary: null,
    });
    assert.equal(byId.get(UUID_A)?.status, 'ready');
    assert.equal(byId.get(UUID_A)?.summary, 'fix the auth refresh bug');

    const human = run(sb, ['list']);
    assert.equal(human.status, 0, human.stderr);
    const docsLine = human.stdout.split('\n').find((l) => l.startsWith('Docs pass  '));
    assert.ok(docsLine, human.stdout);
    assert.match(docsLine, new RegExp(`^Docs pass  \\[docs\\]  missing  .+  ${escapeRe(cwdB)}$`));
    const authLine = human.stdout.split('\n').find((l) => l.startsWith('Auth fix  '));
    assert.ok(authLine, human.stdout);
    assert.match(authLine, /  ready  /);

    assert.deepEqual(readStore(sb), storeBefore);
  });
});
