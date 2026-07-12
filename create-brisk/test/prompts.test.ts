import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { bufferedReader, choose, type Reader } from '../src/prompts';

/** A Reader that replays a fixed script and blanks once it runs dry (EOF). */
function scriptedReader(answers: string[]): Reader {
  let i = 0;
  return {
    question: () => Promise.resolve(answers[i++] ?? ''),
    close: () => {},
  };
}

const opts = [
  { value: 'fs' as const, hint: 'filesystem' },
  { value: 's3' as const, hint: 's3-compatible' },
];

describe('choose', () => {
  let out = '';
  beforeEach(() => {
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('selects by 1-based number', async () => {
    expect(await choose(scriptedReader(['2']), 'Storage?', opts, 'fs')).toBe('s3');
  });

  it('selects by exact value', async () => {
    expect(await choose(scriptedReader(['s3']), 'Storage?', opts, 'fs')).toBe('s3');
  });

  it('takes the default on a blank line', async () => {
    expect(await choose(scriptedReader(['']), 'Storage?', opts, 'fs')).toBe('fs');
  });

  it('gives feedback and re-prompts on an unrecognized answer', async () => {
    const picked = await choose(scriptedReader(['nope', '1']), 'Storage?', opts, 's3');
    expect(picked).toBe('fs'); // the retry ('1') won, not a silent default
    expect(out).toContain("isn't an option");
  });

  it('falls back to the default (not an infinite loop) when input ends after a typo', async () => {
    // 'bad' is unrecognized; the next read is EOF → '' → default.
    expect(await choose(scriptedReader(['bad']), 'Storage?', opts, 's3')).toBe('s3');
  });
});

describe('bufferedReader', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('buffers every piped line up front and replays them in order', async () => {
    const input = new PassThrough();
    input.end('1\ngoogle\n\n'); // lines: '1', 'google', ''
    const r = await bufferedReader(input);
    expect(await r.question('a> ')).toBe('1');
    expect(await r.question('b> ')).toBe('google');
    expect(await r.question('c> ')).toBe(''); // the explicit empty line
    expect(await r.question('d> ')).toBe(''); // past EOF stays blank — never hangs
  });
});
