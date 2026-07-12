#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { argv, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';
import type { GeneratedFile } from './answers.js';
import { generate, nextSteps } from './generate.js';
import { ask } from './prompts.js';

/**
 * Write the scaffolded files, creating parent dirs (some land under `worker/`),
 * skipping any that already exist unless `force`. Throws when nothing was
 * written — every target already existed — so callers can nudge toward --force.
 */
export function writeFiles(
  files: GeneratedFile[],
  opts: { force: boolean; log?: (line: string) => void },
): number {
  const log = opts.log ?? (() => {});
  let wrote = 0;
  for (const file of files) {
    if (existsSync(file.path) && !opts.force) {
      log(`  • skip ${file.path} (exists — pass --force to overwrite)`);
      continue;
    }
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content);
    log(`  • wrote ${file.path}`);
    wrote++;
  }
  if (wrote === 0) {
    throw new Error('scaffolding wrote no files (all targets already exist — pass --force)');
  }
  return wrote;
}

async function main(): Promise<void> {
  const force = argv.includes('--force');
  stdout.write('\ncreate-brisk — scaffold a Brisk deployment\n');
  const answers = await ask();

  writeFiles(generate(answers), { force, log: (line) => stdout.write(`${line}\n`) });

  stdout.write('\nNext steps:\n');
  for (const step of nextSteps(answers)) stdout.write(`${step}\n`);
  stdout.write('\n');
}

// Run only as the CLI entry, not when imported (e.g. by tests).
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
