import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.ts';

const REQUIRED = [
  'npm i --omit=optional',
  'npm link',
  '--plugin-dir',
  '/bookmark',
  '/bookmarks',
  'CBM_STORE',
  'CBM_CLAUDE_BIN',
  'cbm add',
  'cbm list',
  'cbm open',
  'cbm sessions',
  'cbm edit',
  'cbm remove',
];

describe('C16 readme', () => {
  for (const needle of REQUIRED) {
    test(`README.md mentions ${needle}`, () => {
      const text = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
      assert.ok(text.includes(needle), `README.md must contain ${needle}`);
    });
  }
});
