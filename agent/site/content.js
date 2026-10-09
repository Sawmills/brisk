export const tokens = (text) =>
  [
    ...new Set(
      String(text)
        .toLowerCase()
        .match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [],
    ),
  ].slice(0, 20);
export function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, code) => {
    if (code.startsWith('#')) {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return (
      { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[code.toLowerCase()] ?? all
    );
  });
}
export function extractContent(raw, path) {
  const html = /\.html?$/i.test(path);
  const title = html
    ? decodeEntities(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    : '';
  const text = html
    ? raw
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
    : raw;
  return {
    title: title.replace(/\s+/g, ' ').trim().slice(0, 240),
    text: decodeEntities(text).replace(/\s+/g, ' ').trim().slice(0, 12000),
  };
}
export function excerpt(text, query = '', max = 260) {
  const positions = tokens(query)
    .map((t) => text.toLowerCase().indexOf(t))
    .filter((i) => i >= 0);
  const start = positions.length ? Math.max(0, Math.min(...positions) - 65) : 0;
  return `${start ? '…' : ''}${text.slice(start, start + max)}${text.length > start + max ? '…' : ''}`;
}
export function difference(before, after) {
  const old = before.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const next = after.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const oldSet = new Set(old),
    newSet = new Set(next);
  return {
    added: next
      .filter((s) => !oldSet.has(s))
      .slice(0, 8)
      .map((s) => s.slice(0, 600)),
    removed: old
      .filter((s) => !newSet.has(s))
      .slice(0, 8)
      .map((s) => s.slice(0, 600)),
  };
}

export class BriskSource {
  constructor(origin, fetcher = (...args) => fetch(...args)) {
    this.origin = new URL(origin).origin;
    this.fetch = fetcher;
  }
  async read(path, maxBytes = 2_000_000, headers = {}) {
    const response = await this.fetch(new URL(path, this.origin), {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Brisk read failed (${response.status})`);
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('Brisk response exceeds the byte limit');
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(bytes);
  }
  async sites() {
    const result = JSON.parse(await this.read('/api/sites'));
    if (!Array.isArray(result.sites)) throw new Error('Brisk returned no site list');
    if (
      result.sites.some(
        (site) =>
          !site ||
          typeof site.name !== 'string' ||
          !/^[a-z0-9][a-z0-9-]{0,62}$/.test(site.name) ||
          typeof site.updatedAt !== 'string',
      )
    )
      throw new Error('Invalid Brisk site inventory');
    return result.sites;
  }
  async files(site) {
    const { files } = JSON.parse(await this.read(`/api/sites/${encodeURIComponent(site)}/files`));
    if (!Array.isArray(files)) throw new Error('Brisk returned no file list');
    return files;
  }
  async document(site, path) {
    if (path.split('/').some((part) => part === '..' || part === '.'))
      throw new Error('Invalid source path');
    return this.read(
      `/api/sites/${encodeURIComponent(site)}/raw/${path.split('/').map(encodeURIComponent).join('/')}`,
      2_000_000,
    );
  }
  async comments(site) {
    const { docs } = JSON.parse(
      await this.read('/api/db/_plugin%3Acomments?limit=500&sort=-created', 2_000_000, {
        'x-brisk-site': site,
      }),
    );
    if (!Array.isArray(docs)) throw new Error('Brisk returned no comments');
    return { docs, capped: docs.length === 500 };
  }
}
