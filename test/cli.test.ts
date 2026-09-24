import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CLI, ROOT, makeSandbox, run } from './helpers.ts';

const COMMANDS = ['add', 'list', 'open', 'sessions', 'edit', 'remove'];

describe('C1 cli', () => {
  test('package.json is an ES module with the cbm bin and only the pinned SDK dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.type, 'module');
    assert.deepEqual(pkg.bin, { cbm: 'src/cli.ts' });
    assert.deepEqual(pkg.dependencies, { '@anthropic-ai/claude-agent-sdk': '0.3.281' });
    for (const field of ['devDependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies']) {
      assert.equal(Object.hasOwn(pkg, field), false, `package.json must not have ${field}`);
    }
  });

  test('src/cli.ts starts with a node shebang', () => {
    const firstLine = fs.readFileSync(CLI, 'utf8').split('\n')[0];
    assert.equal(firstLine, '#!/usr/bin/env node');
  });

  test('--help exits 0 and names all six commands on stdout', () => {
    const sb = makeSandbox();
    const r = run(sb, ['--help']);
    assert.equal(r.status, 0, r.stderr);
    for (const cmd of COMMANDS) {
      assert.match(r.stdout, new RegExp(`\\b${cmd}\\b`), `usage must name ${cmd}`);
    }
  });

  test('unknown command frob exits 2 with a cbm: error on stderr', () => {
    const sb = makeSandbox();
    const r = run(sb, ['frob']);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /^cbm: /m);
    assert.equal(r.stdout, '');
  });

  test('unknown flag is a usage error exiting 2', () => {
    const sb = makeSandbox();
    const r = run(sb, ['list', '--frob']);
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stdout, '');
  });

  test('no arguments prints usage naming the commands on stderr and exits 2', () => {
    const sb = makeSandbox();
    const r = run(sb, []);
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stdout, '');
    for (const cmd of COMMANDS) {
      assert.match(r.stderr, new RegExp(`\\b${cmd}\\b`), `usage must name ${cmd}`);
    }
  });
});
