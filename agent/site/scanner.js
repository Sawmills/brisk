import { extractContent } from './content.js';

export class Scanner {
  constructor(store, source, { publicOrigin, excludedSites = ['brisk-agent'] } = {}) {
    this.store = store;
    this.source = source;
    this.publicOrigin = new URL(publicOrigin ?? source.origin).origin;
    this.excluded = new Set(excludedSites);
  }
  scan() {
    if (this.pending) return this.pending;
    this.pending = this.perform().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async perform() {
    const started = new Date().toISOString();
    const firstScan = !this.store.get('initialized');
    const errors = [];
    const partialSites = [];
    const sites = (await this.source.sites()).filter((s) => !this.excluded.has(s.name));
    const queue = [...sites];
    this.store.set('scan', { started, running: true, errors: [] });
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (queue.length) {
          const site = queue.shift();
          try {
            const prior = this.store.site(site.name);
            const baseline = firstScan && !prior;
            const url = `${this.publicOrigin}/s/${encodeURIComponent(site.name)}/`;
            const metadata = { ...site, url };
            const old = this.store.documents(site.name);
            const paths = new Set();
            let incomplete = false;
            if (!prior || prior.error || prior.data.updatedAt !== site.updatedAt) {
              const files = await this.source.files(site.name);
              const readable = files.filter(
                (f) =>
                  /\.(html?|md|txt)$/i.test(f.path) && !/(^|\/)(AGENTS|CLAUDE)\.md$/i.test(f.path),
              );
              const selected = readable.filter((f) => f.size <= 2_000_000).slice(0, 10);
              incomplete = selected.length < readable.length;
              for (const file of selected) {
                paths.add(file.path);
                try {
                  const content = extractContent(
                    await this.source.document(site.name, file.path),
                    file.path,
                  );
                  this.store.saveDocument(
                    {
                      site: site.name,
                      path: file.path,
                      title: content.title || `${site.name} / ${file.path}`,
                      text: content.text,
                      url: url + file.path.split('/').map(encodeURIComponent).join('/'),
                    },
                    baseline,
                  );
                } catch (error) {
                  incomplete = true;
                  errors.push({ site: site.name, path: file.path, error: error.message });
                }
              }
              if (!incomplete)
                for (const doc of old)
                  if (doc.path !== '@comments' && !paths.has(doc.path))
                    this.store.removeDocument(doc);
            }
            // Comments change independently of the deploy timestamp.
            if (site.plugins?.includes('comments') || site.plugins == null) {
              const { docs, capped } = await this.source.comments(site.name);
              const text = docs
                .filter((d) => d.status !== 'deleted')
                .map(
                  (d) =>
                    `${d.id}: ${d.text ?? ''} [${d.status ?? 'open'}] ${JSON.stringify(d.replies ?? [])}`,
                )
                .join('\n');
              this.store.saveDocument(
                { site: site.name, path: '@comments', title: `${site.name} — comments`, text, url },
                baseline,
              );
              if (capped) incomplete = true;
            }
            if (incomplete) partialSites.push(site.name);
            this.store.saveSite(
              metadata,
              incomplete ? 'Partial index: a source exceeded scan limits or failed.' : null,
            );
          } catch (error) {
            errors.push({ site: site.name, error: error.message });
            // Do not move the successful deploy stamp on a failed scan.
            const prior = this.store.site(site.name);
            this.store.saveSite(prior?.data ?? site, error.message);
          }
        }
      }),
    );
    // Only a complete site inventory can prove a site was removed.
    const present = new Set(sites.map((s) => s.name));
    for (const site of this.store.sites())
      if (!present.has(site.name)) {
        for (const doc of this.store.documents(site.name)) this.store.removeDocument(doc);
        this.store.removeSite(site.name);
      }
    const result = {
      started,
      finished: new Date().toISOString(),
      running: false,
      errors,
      partialSites,
    };
    this.store.set('scan', result);
    this.store.set('initialized', true);
    this.store.prune();
    await this.store.persist();
    return result;
  }
}
