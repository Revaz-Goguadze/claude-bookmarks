import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  UUID_A,
  makeProject,
  makeSandbox,
  readStore,
  run,
  writeSession,
  writeStore,
} from './helpers.ts';

function fixture() {
  const sb = makeSandbox();
  const cwd = makeProject(sb, 'auth-service');
  writeSession(sb, { id: UUID_A, cwd, prompt: 'fix the auth refresh bug', timestamp: '2026-09-20T10:00:00.000Z' });
  return { sb, cwd };
}

describe('C4 store', () => {
  test('with CBM_STORE unset add writes $CLAUDE_CONFIG_DIR/bookmarks.json', () => {
    const { sb, cwd } = fixture();
    const r = run(sb, ['add', UUID_A, '--name', 'Auth fix'], { env: { CBM_STORE: undefined } });
    assert.equal(r.status, 0, r.stderr);
    const file = path.join(sb.configDir, 'bookmarks.json');
    const store = readStore(sb, file);
    assert.equal(store.version, 1);
    assert.deepEqual(store.bookmarks.map((b) => [b.id, b.name, b.cwd]), [[UUID_A, 'Auth fix', cwd]]);
    assert.equal(fs.existsSync(sb.store), false);
    assert.equal(fs.existsSync(path.join(sb.home, '.claude', 'bookmarks.json')), false);
  });

  test('with CBM_STORE and CLAUDE_CONFIG_DIR unset add writes $HOME/.claude/bookmarks.json', () => {
    const sb = makeSandbox();
    const cwd = makeProject(sb, 'auth-service');
    const homeClaude = path.join(sb.home, '.claude');
    writeSession(sb, {
      id: UUID_A,
      cwd,
      prompt: 'fix the auth refresh bug',
      timestamp: '2026-09-20T10:00:00.000Z',
      configDir: homeClaude,
    });
    const r = run(sb, ['add', UUID_A, '--name', 'Auth fix'], { env: { CBM_STORE: undefined, CLAUDE_CONFIG_DIR: undefined } });
    assert.equal(r.status, 0, r.stderr);
    const store = readStore(sb, path.join(homeClaude, 'bookmarks.json'));
    assert.equal(store.version, 1);
    assert.deepEqual(store.bookmarks.map((b) => [b.id, b.name, b.cwd]), [[UUID_A, 'Auth fix', cwd]]);
    assert.equal(fs.existsSync(sb.store), false);
    assert.equal(fs.existsSync(path.join(sb.configDir, 'bookmarks.json')), false);
  });

  test('list with no store exits 0 and creates no file', () => {
    const { sb } = fixture();
    const configBefore = fs.readdirSync(sb.configDir).sort();
    const r = run(sb, ['list']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(sb.store), false);
    assert.equal(fs.existsSync(sb.storeDir), false);
    assert.deepEqual(fs.readdirSync(sb.configDir).sort(), configBefore);
  });

  test('list with CBM_STORE unset and no store creates no bookmarks.json in the config dir', () => {
    const { sb } = fixture();
    const r = run(sb, ['list'], { env: { CBM_STORE: undefined } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(sb.configDir, 'bookmarks.json')), false);
  });

  for (const [label, content] of [
    ['invalid JSON', '{not json'],
    ['version 2', '{"version":2,"bookmarks":[]}'],
  ]) {
    test(`list on a store with ${label} exits 1 mentioning store and leaves it byte-identical`, () => {
      const { sb } = fixture();
      writeStore(sb, content);
      const r = run(sb, ['list']);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /^cbm: /m);
      assert.ok(r.stderr.includes('store'), `stderr must mention store: ${r.stderr}`);
      assert.equal(fs.readFileSync(sb.store, 'utf8'), content);
      assert.deepEqual(fs.readdirSync(sb.storeDir), ['bookmarks.json']);
    });

    test(`add on a store with ${label} exits 1 mentioning store and leaves it byte-identical`, () => {
      const { sb } = fixture();
      writeStore(sb, content);
      const r = run(sb, ['add', UUID_A, '--name', 'Auth fix']);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /^cbm: /m);
      assert.ok(r.stderr.includes('store'), `stderr must mention store: ${r.stderr}`);
      assert.equal(fs.readFileSync(sb.store, 'utf8'), content);
      assert.deepEqual(fs.readdirSync(sb.storeDir), ['bookmarks.json']);
    });
  }
});
