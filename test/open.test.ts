import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ISO_RE,
  UUID_A,
  addOk,
  makeProject,
  makeSandbox,
  readFakeLog,
  record,
  run,
  writeSession,
} from './helpers.ts';

function fixture() {
  const sb = makeSandbox();
  const cwd = makeProject(sb, 'auth-service');
  writeSession(sb, { id: UUID_A, cwd, prompt: 'fix the auth refresh bug', timestamp: '2026-09-20T10:00:00.000Z' });
  addOk(sb, [UUID_A, '--name', 'Auth fix', '--tag', 'auth']);
  return { sb, cwd };
}

describe('C7 open', () => {
  test('open "auth FIX" runs the claude bin with --resume <uuid> in the bookmark cwd and exits with its code', () => {
    const { sb, cwd } = fixture();
    const t0 = Date.now();
    const r = run(sb, ['open', 'auth FIX'], { env: { FAKE_EXIT: '7' } });
    const t1 = Date.now();
    assert.equal(r.status, 7, r.stderr);
    assert.deepEqual(readFakeLog(sb), { argv: ['--resume', UUID_A], cwd: fs.realpathSync(cwd) });

    const opened = record(sb, UUID_A).lastOpenedAt;
    assert.equal(typeof opened, 'string');
    assert.match(opened as string, ISO_RE);
    const ms = Date.parse(opened as string);
    assert.ok(ms >= t0 && ms <= t1, `lastOpenedAt ${opened} outside test window`);
  });

  test('open leaves every other record field unchanged', () => {
    const { sb } = fixture();
    const before = record(sb, UUID_A);
    const r = run(sb, ['open', 'Auth fix']);
    assert.equal(r.status, 0, r.stderr);
    const after = record(sb, UUID_A);
    assert.deepEqual({ ...after, lastOpenedAt: null }, before);
  });

  test('--fork adds --fork-session after the uuid', () => {
    const { sb, cwd } = fixture();
    const r = run(sb, ['open', 'Auth fix', '--fork']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readFakeLog(sb), { argv: ['--resume', UUID_A, '--fork-session'], cwd: fs.realpathSync(cwd) });
  });
});
