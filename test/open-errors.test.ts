import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
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
  const file = writeSession(sb, { id: UUID_A, cwd, prompt: 'fix the auth refresh bug', timestamp: '2026-09-20T10:00:00.000Z' });
  addOk(sb, [UUID_A, '--name', 'Auth fix']);
  return { sb, cwd, file };
}

describe('C9 open errors', () => {
  test('removed bookmark cwd exits 3 naming the cwd and --allow-missing-cwd without running claude', () => {
    const { sb, cwd } = fixture();
    fs.rmSync(cwd, { recursive: true });
    const r = run(sb, ['open', 'Auth fix']);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /^cbm: /m);
    assert.ok(r.stderr.includes(cwd), `stderr must name the cwd: ${r.stderr}`);
    assert.ok(r.stderr.includes('--allow-missing-cwd'), `stderr must mention --allow-missing-cwd: ${r.stderr}`);
    assert.equal(readFakeLog(sb), null);
    assert.equal(record(sb, UUID_A).lastOpenedAt, null);
  });

  test('--allow-missing-cwd runs claude in cbm own cwd and warns on stderr', () => {
    const { sb, cwd } = fixture();
    fs.rmSync(cwd, { recursive: true });
    const own = path.join(sb.root, 'elsewhere');
    fs.mkdirSync(own);
    const r = run(sb, ['open', 'Auth fix', '--allow-missing-cwd'], { cwd: own });
    assert.equal(r.status, 0, r.stderr);
    assert.notEqual(r.stderr.trim(), '', 'a warning must be printed on stderr');
    assert.deepEqual(readFakeLog(sb), { argv: ['--resume', UUID_A], cwd: fs.realpathSync(own) });
  });

  test('removed session .jsonl exits 4 without running claude and leaves lastOpenedAt unchanged', () => {
    const { sb, file } = fixture();
    const opened = run(sb, ['open', 'Auth fix']);
    assert.equal(opened.status, 0, opened.stderr);
    const lastOpened = record(sb, UUID_A).lastOpenedAt;
    assert.equal(typeof lastOpened, 'string');
    fs.rmSync(sb.fakeLog);

    fs.rmSync(file);
    const r = run(sb, ['open', 'Auth fix']);
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /^cbm: /m);
    assert.equal(readFakeLog(sb), null);
    assert.equal(record(sb, UUID_A).lastOpenedAt, lastOpened);
  });

  test('removed session .jsonl on a never-opened bookmark exits 4 and lastOpenedAt stays null', () => {
    const { sb, file } = fixture();
    fs.rmSync(file);
    const r = run(sb, ['open', 'Auth fix']);
    assert.equal(r.status, 4, r.stderr);
    assert.equal(readFakeLog(sb), null);
    assert.equal(record(sb, UUID_A).lastOpenedAt, null);
  });

  test('CBM_CLAUDE_BIN pointing at a nonexistent path exits 127 and leaves lastOpenedAt unchanged', () => {
    const { sb } = fixture();
    const r = run(sb, ['open', 'Auth fix'], { env: { CBM_CLAUDE_BIN: path.join(sb.root, 'no-such-claude') } });
    assert.equal(r.status, 127, r.stderr);
    assert.match(r.stderr, /^cbm: /m);
    assert.equal(record(sb, UUID_A).lastOpenedAt, null);
  });
});
