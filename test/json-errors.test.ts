import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeSandbox, run, writeStore } from './helpers.ts';

function parseOneLine(stdout: string): unknown {
  assert.ok(stdout.endsWith('\n'), 'json output must end with a newline');
  const body = stdout.slice(0, -1);
  assert.equal(body.includes('\n'), false, `json output must be exactly one line: ${stdout}`);
  return JSON.parse(body);
}

describe('C14 json errors', () => {
  test('list --json on a corrupt store prints one store_corrupt error line and exits 1', () => {
    const sb = makeSandbox();
    writeStore(sb, '{not json');
    const r = run(sb, ['list', '--json']);
    assert.equal(r.status, 1, r.stderr);
    const parsed = parseOneLine(r.stdout) as { ok: boolean; error: { code: string; message: unknown } };
    assert.equal(typeof parsed.error?.message, 'string');
    assert.deepEqual(parsed, { ok: false, error: { code: 'store_corrupt', message: parsed.error.message } });
    assert.equal(fs.readFileSync(sb.store, 'utf8'), '{not json');
  });

  test('sessions --json --limit abc prints one usage error line and exits 2', () => {
    const sb = makeSandbox();
    const r = run(sb, ['sessions', '--json', '--limit', 'abc']);
    assert.equal(r.status, 2, r.stderr);
    const parsed = parseOneLine(r.stdout) as { ok: boolean; error: { code: string; message: unknown } };
    assert.equal(typeof parsed.error?.message, 'string');
    assert.deepEqual(parsed, { ok: false, error: { code: 'usage', message: parsed.error.message } });
  });

  test('list --json on an empty store prints ok:true with no bookmarks', () => {
    const sb = makeSandbox();
    writeStore(sb, '{"version":1,"bookmarks":[]}');
    const r = run(sb, ['list', '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(parseOneLine(r.stdout), { ok: true, data: { bookmarks: [] } });
  });

  test('list --json with no store prints ok:true with no bookmarks and creates no store', () => {
    const sb = makeSandbox();
    const r = run(sb, ['list', '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(parseOneLine(r.stdout), { ok: true, data: { bookmarks: [] } });
    assert.equal(fs.existsSync(sb.store), false);
  });
});
