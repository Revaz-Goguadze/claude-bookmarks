import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';

const CHAIN_TYPES = new Set(['user', 'assistant', 'attachment', 'system', 'progress']);

// The message `claude --resume <id>` opens: the last element of the resumed chain.
export async function currentLeaf(id: string): Promise<string | undefined> {
  const chain = await getSessionMessages(id, { includeSystemMessages: true });
  return chain.at(-1)?.uuid;
}

export async function isOnCurrentBranch(id: string, leafUuid: string): Promise<boolean> {
  const chain = await getSessionMessages(id, { includeSystemMessages: true });
  return chain.some((m) => m.uuid === leafUuid);
}

function sessionFile(id: string): string | undefined {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const projects = path.join(claudeDir, 'projects');
  let dirs: string[];
  try {
    dirs = fs.readdirSync(projects).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  for (const dir of dirs) {
    const file = path.join(projects, dir, `${id}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return undefined;
}

// The newest record (by file position) among leafUuid and its descendants, or undefined
// when leafUuid is not in the session file. Unparsable lines, such as a partial last line
// a live Claude is still writing, are skipped.
export function newestDescendant(id: string, leafUuid: string): string | undefined {
  const file = sessionFile(id);
  if (file === undefined) return undefined;
  const branch = new Set<string>();
  let newest: string | undefined;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof r !== 'object' || r === null || typeof r.uuid !== 'string') continue;
    if (!CHAIN_TYPES.has(r.type as string) || r.isSidechain === true) continue;
    if (r.uuid === leafUuid || (typeof r.parentUuid === 'string' && branch.has(r.parentUuid))) {
      branch.add(r.uuid);
      newest = r.uuid;
    }
  }
  return newest;
}
