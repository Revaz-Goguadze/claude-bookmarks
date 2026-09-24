import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, makeSandbox } from './helpers.ts';

const PLUGIN = path.join(ROOT, 'plugin');

function frontmatter(text: string): string {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, 'file must start with a YAML frontmatter block');
  return m[1];
}

describe('C15 plugin', () => {
  test('plugin.json has name session-bookmarks, version 0.1.0, a description and author Revaz G', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.equal(typeof manifest.description, 'string');
    assert.notEqual(manifest.description.trim(), '');
    assert.deepEqual(manifest, {
      name: 'session-bookmarks',
      version: '0.1.0',
      description: manifest.description,
      author: { name: 'Revaz G' },
    });
  });

  test('bookmark.md frontmatter allows cbm and its body adds the current session from $ARGUMENTS', () => {
    const text = fs.readFileSync(path.join(PLUGIN, 'commands', 'bookmark.md'), 'utf8');
    const fm = frontmatter(text);
    assert.match(fm, /^description: \S/m);
    assert.match(fm, /^argument-hint:/m);
    assert.match(fm, /^allowed-tools: Bash\(cbm:\*\)$/m);
    assert.ok(text.includes('cbm add ${CLAUDE_SESSION_ID}'), 'must run cbm add ${CLAUDE_SESSION_ID}');
    assert.ok(text.includes('$ARGUMENTS'), 'must use $ARGUMENTS');
    assert.ok(text.includes('--name'), 'must build --name');
    assert.ok(text.includes('--tag'), 'must build --tag');
  });

  test('bookmarks.md frontmatter allows cbm and its body runs cbm list $ARGUMENTS', () => {
    const text = fs.readFileSync(path.join(PLUGIN, 'commands', 'bookmarks.md'), 'utf8');
    const fm = frontmatter(text);
    assert.match(fm, /^description: \S/m);
    assert.match(fm, /^argument-hint:/m);
    assert.match(fm, /^allowed-tools: Bash\(cbm:\*\)$/m);
    assert.ok(text.includes('cbm list $ARGUMENTS'), 'must run cbm list $ARGUMENTS');
  });

  test('claude plugin validate plugin exits 0 with Validation passed', () => {
    const sb = makeSandbox();
    const r = spawnSync('claude', ['plugin', 'validate', 'plugin'], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: sb.home,
        CLAUDE_CONFIG_DIR: sb.configDir,
      },
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (r.error) throw r.error;
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('Validation passed'), r.stdout);
  });
});
