import { difference, excerpt, tokens } from './content.js';

// One IndexedDB record commits each completed check atomically. No server stores this index.
export class Store {
  constructor(data = {}) {
    this.data = { sites: {}, documents: {}, changes: [], state: {}, ...data };
  }
  static async open() {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('brisk-agent-index', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('index');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const data = await new Promise((resolve, reject) => {
      const request = db.transaction('index').objectStore('index').get('content');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const store = new Store(data);
    store.database = db;
    store.prune();
    return store;
  }
  async persist() {
    if (!this.database) return;
    await new Promise((resolve, reject) => {
      const tx = this.database.transaction('index', 'readwrite');
      tx.objectStore('index').put(this.data, 'content');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Browser storage failed'));
    });
  }
  get(key) {
    return this.data.state[key];
  }
  set(key, value) {
    this.data.state[key] = value;
  }
  site(name) {
    return Object.hasOwn(this.data.sites, name) ? this.data.sites[name] : undefined;
  }
  sites() {
    return Object.values(this.data.sites).map((row) => ({
      ...row.data,
      checked: row.checked,
      error: row.error,
    }));
  }
  saveSite(site, error = null) {
    this.data.sites[site.name] = { data: site, checked: new Date().toISOString(), error };
  }
  removeSite(name) {
    delete this.data.sites[name];
  }
  documents(site) {
    return Object.values(this.data.documents).filter((doc) => doc.site === site);
  }
  saveDocument(doc, baseline = false) {
    const id = `${doc.site}/${doc.path}`;
    const before = this.data.documents[id];
    const now = new Date().toISOString();
    if (!before && Object.keys(this.data.documents).length >= 1500)
      throw new Error('Browser index limit reached: 1500 sources');
    if (!baseline && (before?.text !== doc.text || before?.title !== doc.title))
      this.change(doc, before ? 'updated' : 'added', difference(before?.text ?? '', doc.text), now);
    this.data.documents[id] = { ...doc, id, text: doc.text.slice(0, 12000), checked: now };
  }
  removeDocument(doc) {
    this.change(doc, 'removed', { added: [], removed: [doc.text.slice(0, 600)] });
    delete this.data.documents[doc.id];
  }
  change(doc, kind, data, observed = new Date().toISOString()) {
    this.data.changes.unshift({
      site: doc.site,
      title: doc.title,
      url: doc.url,
      kind,
      data,
      observed,
    });
    this.data.changes = this.data.changes.slice(0, 1000);
  }
  search(query, limit = 20) {
    const words = tokens(query).filter(
      (t) =>
        ![
          'the',
          'a',
          'an',
          'what',
          'where',
          'how',
          'find',
          'show',
          'about',
          'and',
          'for',
          'with',
          'this',
          'that',
          'are',
          'was',
          'is',
          'me',
          'in',
          'of',
          'to',
        ].includes(t),
    );
    return Object.values(this.data.documents)
      .filter((doc) => doc.text)
      .map((doc) => ({
        ...doc,
        score: words.reduce(
          (n, word) =>
            n +
            (doc.title.toLowerCase().includes(word) ? 3 : 0) +
            (doc.text.toLowerCase().includes(word) ? 1 : 0),
          0,
        ),
        excerpt: excerpt(doc.text, query),
      }))
      .filter((doc) => !words.length || doc.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (this.site(b.site)?.data.updatedAt ?? '').localeCompare(
            this.site(a.site)?.data.updatedAt ?? '',
          ),
      )
      .slice(0, limit);
  }
  changes(follows = [], all = false) {
    return this.data.changes
      .filter(
        (row) =>
          all ||
          follows.some((f) =>
            f.kind === 'site'
              ? f.value === row.site
              : tokens(f.value).some((t) =>
                  `${row.title} ${JSON.stringify(row.data)}`.toLowerCase().includes(t),
                ),
          ),
      )
      .slice(0, 100);
  }
  discover(follows = []) {
    const rows = this.search(
      follows
        .filter((f) => f.kind === 'topic')
        .map((f) => f.value)
        .join(' '),
      60,
    );
    for (const f of follows.filter((f) => f.kind === 'site'))
      rows.unshift(
        ...this.documents(f.value)
          .slice(0, 5)
          .map((doc) => ({ ...doc, excerpt: excerpt(doc.text) })),
      );
    const seen = new Set();
    return rows
      .filter((row) => {
        if (seen.has(row.site)) return false;
        seen.add(row.site);
        return true;
      })
      .slice(0, 20)
      .map((row) => {
        const matched = follows.filter((f) =>
          f.kind === 'site'
            ? f.value === row.site
            : tokens(f.value).some((t) => `${row.title} ${row.excerpt}`.toLowerCase().includes(t)),
        );
        return {
          ...row,
          reason: matched.length
            ? `Matches your follows: ${matched.map((f) => f.value).join(', ')}`
            : 'Recently updated site.',
        };
      });
  }
  snapshot(query) {
    return this.search(query, 10).map((row) => ({ ...row, text: row.text.slice(0, 6000) }));
  }
  prune() {
    const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
    this.data.changes = this.data.changes.filter((row) => row.observed >= cutoff).slice(0, 1000);
  }
  stats() {
    return {
      sites: this.sites().length,
      documents: Object.keys(this.data.documents).length,
      changes: this.data.changes.length,
      scan: this.get('scan'),
    };
  }
}
