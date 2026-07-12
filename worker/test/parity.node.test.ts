import { afterAll, beforeAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { buildNodeApp, storageFromEnv } from '../src/platform/node/platform';
import { createFsStorage } from '../src/platform/node/storage-fs';
import { configFromEnv } from '../src/platform/node/config';
import { listDeploys } from '../src/sites';
import type { Platform } from '../src/platform/types';
import { runDeployParity, runHttpParity, runRealtimeParity } from './parity/suite';

let server: Server;
let historyServer: Server;
let dir = '';
let base = '';
let historyBase = '';
let versionsOf: (site: string) => Promise<number[]>;
let historyVersionsOf: (site: string) => Promise<number[]>;

/** Boot a Node assembly (filesystem storage + temp SQLite, AUTH=none) under
 *  `root`, plus a reader that reports the retained deploy versions (newest
 *  first) from that instance's sqlite via the real listDeploys. */
function bootApp(root: string, extraEnv: NodeJS.ProcessEnv) {
  const { app, db } = buildNodeApp({
    config: configFromEnv({ AUTH: 'none', ...extraEnv }),
    dbPath: join(root, 'brisk.sqlite'),
    migrationsDir: join(__dirname, '..', 'migrations'),
    assetsDir: join(__dirname, '..', 'assets'),
    storage: createFsStorage(join(root, 'objects')),
  });
  const reader = (site: string): Promise<number[]> =>
    listDeploys({ db } as unknown as Platform, site).then((rows) => rows.map((r) => r.version));
  return { app, reader };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'brisk-parity-'));

  // Default instance: DEPLOY_HISTORY off (prune), plus the websocket server.
  const main = bootApp(join(dir, 'off'), {});
  versionsOf = main.reader;
  const wss = new WebSocketServer({ noServer: true });
  await new Promise<void>((resolve) => {
    server = serve(
      { fetch: main.app.fetch, websocket: { server: wss }, port: 0, hostname: '127.0.0.1' },
      (info) => {
        base = `http://127.0.0.1:${info.port}`;
        resolve();
      },
    ) as Server;
  });

  // Second instance: DEPLOY_HISTORY=on, so retention is exercised on sqlite.
  const hist = bootApp(join(dir, 'on'), { DEPLOY_HISTORY: 'on' });
  historyVersionsOf = hist.reader;
  await new Promise<void>((resolve) => {
    historyServer = serve({ fetch: hist.app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      historyBase = `http://127.0.0.1:${info.port}`;
      resolve();
    }) as Server;
  });

  void storageFromEnv; // referenced to keep the import meaningful; real entry uses it
});

afterAll(async () => {
  server.closeAllConnections?.();
  historyServer.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => historyServer.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

runHttpParity(() => base);
runRealtimeParity(() => base);
runDeployParity({
  base: () => base,
  deploys: (site) => versionsOf(site),
  historyBase: () => historyBase,
  historyDeploys: (site) => historyVersionsOf(site),
});
