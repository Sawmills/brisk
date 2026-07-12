import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONFIG_VARS, SECRET_VARS, type Answers } from '../src/answers.js';
import { generate } from '../src/generate.js';

/**
 * create-brisk is downstream of the worker: it writes the config an instance
 * boots from. Nothing in the type system connects the two, so a var added to
 * `Env` silently never reaches a scaffolded instance — which is exactly how
 * DEPLOY_HISTORY, OPENAI_API_KEY, and ALLOWED_EMAILS went missing. These tests
 * make that drift a failing build instead of a bug someone hits in production.
 */

const here = dirname(fileURLToPath(import.meta.url));
const envTs = readFileSync(join(here, '..', '..', 'worker', 'src', 'env.ts'), 'utf8');

/** The optional members of `Env` — bindings (DB, BUCKET, …) are required, so
 *  keying off `?:` picks out exactly the instance config vars. */
function envVarsFromWorker(): string[] {
  return [...envTs.matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\?:/gm)].map((m) => m[1]!);
}

/** DEPLOY_HISTORY → deployHistory: how the helm chart names the same var. */
const camel = (v: string): string =>
  v.toLowerCase().replace(/_(.)/g, (_, c: string) => c.toUpperCase());

const answers = (over: Partial<Answers> = {}): Answers => ({
  target: 'compose',
  baseHost: 'brisk.example.com',
  auth: 'google',
  allowedEmailDomains: 'example.com',
  storage: 'fs',
  image: 'ghcr.io/usebrisk/brisk:latest',
  ...over,
});

const fileNamed = (a: Answers, path: string): string => {
  const file = generate(a).find((f) => f.path === path);
  if (!file) throw new Error(`no generated file at ${path}`);
  return file.content;
};

describe('env var parity with the worker', () => {
  it('tracks every instance var declared in worker/src/env.ts', () => {
    // If this fails you added a var to Env: add it to CONFIG_VARS or SECRET_VARS,
    // then to every emitter in generate.ts (the tests below will tell you which).
    expect([...envVarsFromWorker()].sort()).toEqual(
      [...CONFIG_VARS, ...SECRET_VARS].sort() as string[],
    );
  });

  // These only mean anything once AUTH=google: the allowlists gate the login, and
  // the session/OAuth/CI secrets exist to serve it. The targets that aim for a
  // minimal artifact (helm values, the CF dashboard checklist) legitimately drop
  // them under AUTH=none. The env files don't: they're the "here is everything
  // you can set" surface, so they carry every var in every mode.
  const GOOGLE_ONLY = [
    'ALLOWED_EMAIL_DOMAINS',
    'ALLOWED_EMAILS',
    'SESSION_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'DEPLOY_TOKEN',
  ];
  const liveIn = (auth: 'google' | 'none', vars: readonly string[]): string[] =>
    auth === 'google' ? [...vars] : vars.filter((v) => !GOOGLE_ONLY.includes(v));

  for (const auth of ['google', 'none'] as const) {
    it(`compose .env lists every var (AUTH=${auth})`, () => {
      const env = fileNamed(answers({ target: 'compose', auth }), '.env');
      for (const v of [...CONFIG_VARS, ...SECRET_VARS]) expect(env).toContain(`${v}=`);
    });

    it(`cloudflare .dev.vars lists every var (AUTH=${auth})`, () => {
      const vars = fileNamed(answers({ target: 'cloudflare', auth }), 'worker/.dev.vars');
      for (const v of [...CONFIG_VARS, ...SECRET_VARS]) expect(vars).toContain(`${v}=`);
    });

    it(`cloudflare checklist names every var in play (AUTH=${auth})`, () => {
      const doc = fileNamed(answers({ target: 'cloudflare', auth }), 'BRISK-CLOUDFLARE.md');
      for (const v of liveIn(auth, [...CONFIG_VARS, ...SECRET_VARS])) expect(doc).toContain(v);
    });

    // Helm carries config in values and secrets via --set/existingSecret, so only
    // the config half belongs here — under the chart's camelCase spelling.
    it(`helm values carry every config var in play (AUTH=${auth})`, () => {
      const values = fileNamed(answers({ target: 'kubernetes', auth }), 'brisk-values.yaml');
      for (const v of liveIn(auth, CONFIG_VARS)) expect(values).toContain(`${camel(v)}:`);
    });
  }

  it('never inlines a secret into the helm values', () => {
    const values = fileNamed(answers({ target: 'kubernetes' }), 'brisk-values.yaml');
    for (const v of SECRET_VARS) expect(values).not.toContain(camel(v));
  });
});
