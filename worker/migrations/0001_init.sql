-- Sites are folders of files in R2; this table is the pointer to each site's
-- live deploy. Swapping the pointer is what makes deploys atomic.
CREATE TABLE sites (
  name TEXT PRIMARY KEY,
  active_deploy TEXT NOT NULL,
  files INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- The Firebase-style document store behind brisk.db: schemaless JSON docs in
-- named collections, namespaced per site.
CREATE TABLE docs (
  site TEXT NOT NULL,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (site, collection, id)
);

CREATE INDEX docs_by_creation ON docs (site, collection, created_at);
