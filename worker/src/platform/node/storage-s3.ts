import { createHash } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import type { ListResult, Storage, StoredObject } from '../types';

export interface S3Config {
  endpoint: string; // e.g. https://s3.us-east-1.amazonaws.com or http://localhost:9000
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string; // explicit — never let aws4fetch guess (breaks for MinIO hosts)
}

const decodeXml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Build the body and headers for a multi-object DeleteObjects request.
 * AWS S3 rejects DeleteObjects (400 InvalidRequest) unless it carries an
 * integrity header — and aws4fetch signs S3 with `x-amz-content-sha256:
 * UNSIGNED-PAYLOAD`, so the payload hash can't stand in. Content-MD5 over the
 * exact XML body is the broadest-compatible choice (it also satisfies MinIO).
 * Pure and exported so the header can be unit-tested without a live S3/MinIO.
 */
export function deleteRequestParts(keys: string[]): {
  body: string;
  headers: Record<string, string>;
} {
  const body =
    `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>` +
    keys.map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`).join('') +
    `</Delete>`;
  // MD5 over the UTF-8 bytes fetch will send — matches non-ASCII keys too.
  const contentMd5 = createHash('md5').update(body, 'utf8').digest('base64');
  return { body, headers: { 'content-type': 'application/xml', 'content-md5': contentMd5 } };
}

/** S3-compatible Storage (AWS S3 and MinIO) over aws4fetch. Path-style URLs. */
export function createS3Storage(cfg: S3Config): Storage {
  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
    service: 's3',
  });
  const base = cfg.endpoint.replace(/\/+$/, '');
  const bucketUrl = `${base}/${cfg.bucket}`;
  const objUrl = (key: string) =>
    `${bucketUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;

  return {
    async get(key): Promise<StoredObject | null> {
      const res = await aws.fetch(objUrl(key), { method: 'GET' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 get ${key}: ${res.status}`);
      return {
        body: res.body!,
        contentType: res.headers.get('content-type') ?? undefined,
        etag: (res.headers.get('etag') ?? '').replace(/"/g, ''),
        size: Number(res.headers.get('content-length') ?? 0),
      };
    },

    async put(key, body, opts): Promise<void> {
      // Buffer the body so the PUT carries a Content-Length. A ReadableStream
      // body forces chunked Transfer-Encoding, which MinIO (and other strict S3
      // servers) reject with 411 Length Required. Deploy objects are individual
      // files, so the buffer is bounded by the largest single asset.
      const bytes =
        body instanceof ReadableStream
          ? new Uint8Array(await new Response(body).arrayBuffer())
          : body;
      const res = await aws.fetch(objUrl(key), {
        method: 'PUT',
        body: bytes,
        headers: opts?.contentType ? { 'content-type': opts.contentType } : {},
      });
      if (!res.ok) throw new Error(`S3 put ${key}: ${res.status}`);
    },

    async list({ prefix, cursor }): Promise<ListResult> {
      const u = new URL(bucketUrl);
      u.searchParams.set('list-type', '2');
      u.searchParams.set('prefix', prefix);
      if (cursor) u.searchParams.set('continuation-token', cursor);
      const res = await aws.fetch(u.toString(), { method: 'GET' });
      if (!res.ok) throw new Error(`S3 list ${prefix}: ${res.status}`);
      const xml = await res.text();
      const objects: { key: string; size: number }[] = [];
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const block = m[1]!;
        const k = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
        const size = block.match(/<Size>(\d+)<\/Size>/)?.[1];
        if (k != null) objects.push({ key: decodeXml(k), size: Number(size ?? 0) });
      }
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      const next = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1];
      return { objects, cursor: truncated ? next : undefined };
    },

    async delete(keys): Promise<void> {
      if (keys.length === 0) return;
      const { body, headers } = deleteRequestParts(keys);
      const res = await aws.fetch(`${bucketUrl}?delete`, { method: 'POST', headers, body });
      if (!res.ok) throw new Error(`S3 delete batch: ${res.status}`);
    },
  };
}
