import { describe, expect, it } from 'vitest';
import { generate, nextSteps } from '../src/generate';
import type { Answers } from '../src/answers';

const base: Answers = {
  target: 'compose',
  baseHost: 'brisk.example.com',
  auth: 'google',
  allowedEmailDomains: '',
  storage: 'fs',
  image: 'ghcr.io/usebrisk/brisk:latest',
};
const fileMap = (a: Answers) => Object.fromEntries(generate(a).map((f) => [f.path, f.content]));

describe('compose target', () => {
  it('emits a self-contained docker-compose.yml + .env (fs)', () => {
    const f = fileMap(base);
    expect(f['docker-compose.yml']).toContain('image: ghcr.io/usebrisk/brisk:latest');
    expect(f['docker-compose.yml']).toContain('env_file');
    expect(f['docker-compose.yml']).not.toContain('build:'); // image-based, not source build
    expect(f['docker-compose.yml']).not.toContain('minio'); // fs storage → no minio
    expect(f['.env']).toContain('AUTH=google');
    expect(f['.env']).toContain('BASE_HOST=brisk.example.com');
    expect(f['.env']).toContain('STORAGE=fs');
    expect(f['.env']).toContain('SESSION_SECRET='); // placeholder present
    expect(f['.env']).toContain('SQLITE_PATH=/data/brisk.sqlite');
  });

  it('does not inject PORT into the container (host-side publish var only)', () => {
    // The container always listens on 8787; PORT only picks the published host
    // port via ${PORT:-8787}:8787. Injecting PORT would break that mapping.
    const f = fileMap(base);
    expect(f['docker-compose.yml']).toContain('${PORT:-8787}:8787');
    // No `PORT=...` assignment in the env_file (comment lines mentioning PORT are fine).
    expect(f['.env']).not.toMatch(/^PORT=/m);
  });

  it('flags an empty Google allowlist in .env and fills it when provided', () => {
    expect(fileMap(base)['.env']).toContain('WARNING: an empty allowlist');
    const withDomain = fileMap({ ...base, allowedEmailDomains: 'yourco.com' })['.env'];
    expect(withDomain).toContain('ALLOWED_EMAIL_DOMAINS=yourco.com');
    expect(withDomain).not.toContain('WARNING: an empty allowlist');
  });

  it('adds a minio service and S3 env when storage is s3', () => {
    const f = fileMap({
      ...base,
      storage: 's3',
      s3: { endpoint: 'http://minio:9000', bucket: 'brisk', region: 'us-east-1' },
    });
    expect(f['docker-compose.yml']).toContain('minio');
    expect(f['.env']).toContain('STORAGE=s3');
    expect(f['.env']).toContain('S3_ENDPOINT=http://minio:9000');
    expect(f['.env']).toContain('S3_BUCKET=brisk');
    expect(f['.env']).toContain('S3_ACCESS_KEY_ID=');
  });
});

describe('kubernetes target', () => {
  it('emits a Helm values override file with no inlined secrets', () => {
    const f = fileMap({ ...base, target: 'kubernetes' });
    const v = f['brisk-values.yaml'];
    expect(v).toContain('repository: ghcr.io/usebrisk/brisk');
    expect(v).toContain('auth: google');
    expect(v).toContain('baseHost: brisk.example.com');
    expect(v).toContain('storage: fs');
    expect(v).toContain('enabled: true'); // ingress on (baseHost set)
    // secrets must NOT be inlined with values
    expect(v).not.toMatch(/sessionSecret:\s*\S/);
  });

  it('omits the ingress when no baseHost is given', () => {
    const v = fileMap({ ...base, target: 'kubernetes', baseHost: '' })['brisk-values.yaml'];
    expect(v).toMatch(/enabled:\s*false/);
  });

  it('carries s3 config into the Helm values when storage is s3', () => {
    const v = fileMap({
      ...base,
      target: 'kubernetes',
      storage: 's3',
      s3: { endpoint: 'http://minio:9000', bucket: 'brisk', region: 'eu-west-1' },
    })['brisk-values.yaml'];
    expect(v).toContain('storage: s3');
    expect(v).toContain('endpoint: http://minio:9000');
    expect(v).toContain('bucket: brisk');
    expect(v).toContain('region: eu-west-1');
  });

  it('emits the allowlist with a warning under AUTH=google (fills it when given)', () => {
    const empty = fileMap({ ...base, target: 'kubernetes' })['brisk-values.yaml'];
    expect(empty).toContain('allowedEmailDomains:');
    expect(empty).toContain("allowedEmailDomains: ''");
    expect(empty).toContain('WARNING: an empty allowlist admits ANY Google account');
    const set = fileMap({ ...base, target: 'kubernetes', allowedEmailDomains: 'yourco.com' })[
      'brisk-values.yaml'
    ];
    expect(set).toContain("allowedEmailDomains: 'yourco.com'");
  });

  it('omits the allowlist keys under AUTH=none', () => {
    const v = fileMap({ ...base, target: 'kubernetes', auth: 'none' })['brisk-values.yaml'];
    expect(v).not.toContain('allowedEmailDomains');
  });
});

describe('cloudflare target', () => {
  it('writes .dev.vars under worker/ (where wrangler dev reads it) + a checklist', () => {
    const f = fileMap({ ...base, target: 'cloudflare' });
    expect(f['worker/.dev.vars']).toContain('AUTH=google');
    expect(f['.dev.vars']).toBeUndefined(); // not the invocation cwd
    expect(f['BRISK-CLOUDFLARE.md']).toContain('worker/.dev.vars');
    expect(f['BRISK-CLOUDFLARE.md']).toContain('wrangler secret put SESSION_SECRET');
  });

  it('does not carry the PORT publish note into cloudflare vars', () => {
    // PORT is a docker-compose host-publish concern; Workers has no such mapping.
    expect(fileMap({ ...base, target: 'cloudflare' })['worker/.dev.vars']).not.toContain('PORT');
  });
});

describe('nextSteps', () => {
  it('tells compose users to bring the stack up', () => {
    expect(nextSteps(base).join('\n')).toContain('docker compose');
  });
  it('warns when auth is none', () => {
    expect(
      nextSteps({ ...base, auth: 'none' })
        .join('\n')
        .toLowerCase(),
    ).toContain('trusted');
  });
  it('warns when AUTH=google is left with an empty allowlist (every target)', () => {
    for (const target of ['compose', 'kubernetes', 'cloudflare'] as const) {
      const out = nextSteps({ ...base, target }).join('\n');
      expect(out).toContain('empty allowlist admits ANY Google account');
    }
  });
  it('drops the allowlist warning once a domain is set', () => {
    expect(nextSteps({ ...base, allowedEmailDomains: 'yourco.com' }).join('\n')).not.toContain(
      'empty allowlist',
    );
  });
  it('points k8s users at --set config.allowedEmailDomains', () => {
    expect(nextSteps({ ...base, target: 'kubernetes' }).join('\n')).toContain(
      '--set config.allowedEmailDomains=',
    );
  });
});
