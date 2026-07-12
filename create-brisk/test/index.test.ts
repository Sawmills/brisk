import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFiles } from '../src/index';
import type { GeneratedFile } from '../src/answers';

describe('writeFiles', () => {
  let dir: string;
  // b.txt sits under a nested dir to exercise the mkdir (cloudflare → worker/).
  const files = (): GeneratedFile[] => [
    { path: join(dir, 'a.txt'), content: 'A' },
    { path: join(dir, 'worker', 'b.txt'), content: 'B' },
  ];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'create-brisk-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes every file (creating parent dirs) and returns the count', () => {
    expect(writeFiles(files(), { force: false })).toBe(2);
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('A');
    expect(readFileSync(join(dir, 'worker', 'b.txt'), 'utf8')).toBe('B');
  });

  it('skips files that already exist and leaves them untouched', () => {
    writeFileSync(join(dir, 'a.txt'), 'OLD');
    expect(writeFiles(files(), { force: false })).toBe(1); // only b.txt written
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('OLD');
  });

  it('overwrites existing files with --force', () => {
    writeFileSync(join(dir, 'a.txt'), 'OLD');
    expect(writeFiles(files(), { force: true })).toBe(2);
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('A');
  });

  it('throws when every target already exists (nudges toward --force)', () => {
    mkdirSync(join(dir, 'worker'), { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'x');
    writeFileSync(join(dir, 'worker', 'b.txt'), 'y');
    expect(() => writeFiles(files(), { force: false })).toThrow(/--force/);
  });
});
