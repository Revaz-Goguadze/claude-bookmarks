import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  UUID_A,
  UUID_B,
  addOk,
  makeProject,
  makeSandbox,
  record,
  run,
  writeSession,
} from './helpers.ts';

function fixture() {
  const sb = makeSandbox();
  const cwd = makeProject(sb, 'auth-service');
  writeSession(sb, { id: UUID_A, cwd, prompt: 'fix the auth refresh bug', timestamp: '2026-09-20T10:00:00.000Z' });
  addOk(sb, [UUID_A, '--name', 'Auth fix']);
  return { sb, cwd };
}

describe('C8 print command', () => {
  test('--print-command prints the exact cd and resume line without running claude or touching lastOpenedAt', () => {
    const { sb, cwd } = fixture();
    const r = run(sb, ['open', 'Auth fix', '--print-command']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `cd '${cwd}' && '${sb.fakeBin}' --resume ${UUID_A}\n`);
    assert.equal(fs.existsSync(sb.fakeLog), false, 'fake claude must not run');
    assert.equal(record(sb, UUID_A).lastOpenedAt, null);
  });

  test('--print-command with --fork appends --fork-session', () => {
    const { sb, cwd } = fixture();
    const r = run(sb, ['open', 'Auth fix', '--print-command', '--fork']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `cd '${cwd}' && '${sb.fakeBin}' --resume ${UUID_A} --fork-session\n`);
    assert.equal(fs.existsSync(sb.fakeLog), false, 'fake claude must not run');
    assert.equal(record(sb, UUID_A).lastOpenedAt, null);
  });

  test('with CBM_CLAUDE_BIN unset the bin part is quoted claude', () => {
    const { sb, cwd } = fixture();
    const r = run(sb, ['open', 'Auth fix', '--print-command'], { env: { CBM_CLAUDE_BIN: undefined } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `cd '${cwd}' && 'claude' --resume ${UUID_A}\n`);
    assert.equal(record(sb, UUID_A).lastOpenedAt, null);
  });

  test('an embedded single quote in the cwd is written as a closed, escaped and reopened quote', () => {
    const sb = makeSandbox();
    const cwd = makeProject(sb, "it's here");
    writeSession(sb, { id: UUID_B, cwd, prompt: 'quote handling', timestamp: '2026-09-20T10:00:00.000Z' });
    addOk(sb, [UUID_B, '--name', 'Quoted']);
    const r = run(sb, ['open', 'Quoted', '--print-command']);
    assert.equal(r.status, 0, r.stderr);
    const quotedCwd = cwd.replace(/'/g, `'\\''`);
    assert.equal(r.stdout, `cd '${quotedCwd}' && '${sb.fakeBin}' --resume ${UUID_B}\n`);
  });
});
