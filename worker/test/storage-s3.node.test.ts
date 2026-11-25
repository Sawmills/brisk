import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createS3Storage, deleteRequestParts } from '../src/platform/node/storage-s3';

// AWS S3 rejects a multi-object DeleteObjects (400 InvalidRequest) without an
// integrity header, and aws4fetch signs S3 with UNSIGNED-PAYLOAD so the payload
// hash can't cover it. These tests pin the Content-MD5 that keeps `brisk delete`
// (and the DEPLOY_HISTORY prune) working on live AWS — MinIO tolerates its
// absence, so the fs-only parity suite can't catch a regression here.

const md5b64 = (bytes: Buffer | string): string =>
  createHash('md5')
    .update(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes)
    .digest('base64');

describe('deleteRequestParts', () => {
  it('sends Content-MD5 = base64(md5(body)) alongside the XML content-type', () => {
    // A non-ASCII key exercises the UTF-8 byte path fetch actually sends.
    const keys = ['deploys/site/7/index.html', 'deploys/site/7/café/<script>.js'];
    const { body, headers } = deleteRequestParts(keys);

    expect(headers['content-type']).toBe('application/xml');
    expect(headers['content-md5']).toBe(md5b64(body));
    // The body is the signed payload, so the digest must match those exact bytes.
    expect(headers['content-md5']).toBe(md5b64(Buffer.from(body, 'utf8')));
    expect(body).toContain('&lt;script&gt;'); // keys are XML-escaped, unchanged
  });
});

describe('createS3Storage delete() wiring', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('signs an outgoing DeleteObjects whose Content-MD5 matches the wire body', async () => {
    let captured: Request | undefined;
    globalThis.fetch = (async (input: Request) => {
      captured = input as Request;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const storage = createS3Storage({
      endpoint: 'https://s3.us-east-1.amazonaws.com',
      bucket: 'brisk-objects',
      accessKeyId: 'AKIATEST',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    });
    await storage.delete(['deploys/site/1/a.txt', 'deploys/site/1/b.txt']);

    expect(captured).toBeDefined();
    const req = captured!;
    expect(req.method).toBe('POST');
    expect(new URL(req.url).search).toBe('?delete');

    // The digest must cover the exact bytes that go over the wire.
    const sentBytes = Buffer.from(await req.clone().arrayBuffer());
    expect(req.headers.get('content-md5')).toBe(md5b64(sentBytes));

    // aws4fetch signs S3 with UNSIGNED-PAYLOAD, and it must actually sign the
    // Content-MD5 (present in SignedHeaders) or AWS ignores/az-rejects it.
    expect(req.headers.get('x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD');
    expect(req.headers.get('authorization')).toMatch(/SignedHeaders=[^,]*content-md5/);
  });
});

describe('createS3Storage get() etag', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const storageWithEtag = (etag: string | null) => {
    globalThis.fetch = (async () =>
      new Response('body', {
        status: 200,
        headers: etag === null ? {} : { etag },
      })) as typeof fetch;
    return createS3Storage({
      endpoint: 'https://s3.us-east-1.amazonaws.com',
      bucket: 'brisk-objects',
      accessKeyId: 'AKIATEST',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    });
  };

  // Served as-is in the etag header, and compression prefixes it with W/, so it
  // must stay a quoted entity-tag (W/"abc", never W/abc).
  it('keeps the quotes S3 sends', async () => {
    expect((await storageWithEtag('"abc123"').get('k'))?.etag).toBe('"abc123"');
  });
  it('adds quotes when an S3-compatible server drops them', async () => {
    expect((await storageWithEtag('abc123').get('k'))?.etag).toBe('"abc123"');
  });
  it('leaves a missing etag empty', async () => {
    expect((await storageWithEtag(null).get('k'))?.etag).toBe('');
  });
});
