import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { api, authHeaders, loadConfig, serverUrl } from './config.js';
import { agentsMd, briskJson, starterHtml } from './templates.js';
import { bold, cyan, dim, green, humanBytes, timeAgo, yellow } from './ui.js';

export interface Flags {
  site?: string;
  server?: string;
}

interface SiteInfo {
  name: string;
  files: number;
  bytes: number;
  updatedAt: string;
  updatedBy: string | null;
  url: string;
}

const SKIP = new Set(['.git', 'node_modules', '.DS_Store', 'brisk.json']);

function resolveSite(dir: string, flags: Flags): string {
  const site = flags.site ?? loadConfig(dir).site ?? path.basename(path.resolve(dir));
  return slugify(site);
}

/** Folder names become site names: lowercase dns labels, nothing fancier. */
const slugify = (name: string): string => name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

async function collectFiles(dir: string): Promise<{ rel: string; abs: string }[]> {
  const out: { rel: string; abs: string }[] = [];
  for (const entry of await fsp.readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(dir, abs).split(path.sep).join('/');
    if (rel.split('/').some((part) => SKIP.has(part))) continue;
    out.push({ rel, abs });
  }
  return out;
}

// ---- commands ---------------------------------------------------------------

export async function init(name: string | undefined, flags: Flags): Promise<void> {
  const dir = name ? path.resolve(name) : process.cwd();
  const site = slugify(name ?? path.basename(dir));
  await fsp.mkdir(dir, { recursive: true });

  const write = async (file: string, content: string) => {
    const target = path.join(dir, file);
    if (fs.existsSync(target)) {
      console.log(dim(`  skip ${file} (exists)`));
      return;
    }
    await fsp.writeFile(target, content);
    console.log(`  ${green('+')} ${file}`);
  };

  console.log(`${bold('brisk init')} ${cyan(site)}`);
  await write('brisk.json', briskJson(site));
  await write('index.html', starterHtml(site));
  await write('AGENTS.md', agentsMd(site));
  console.log(
    `\nNext: ${bold(`brisk deploy${name ? ` ${name}` : ''}`)}${flags.server ? dim(` --server ${flags.server}`) : ''}`,
  );
}

export async function deploy(dirArg: string | undefined, flags: Flags): Promise<SiteInfo> {
  const dir = path.resolve(dirArg ?? '.');
  const site = resolveSite(dir, flags);
  const server = serverUrl(flags.server, loadConfig(dir));

  const files = await collectFiles(dir);
  if (!files.length) throw new Error(`nothing to deploy in ${dir}`);

  const form = new FormData();
  for (const { rel, abs } of files) {
    form.append('files', new File([await fsp.readFile(abs)], rel));
  }

  const started = Date.now();
  const info = await api<SiteInfo>(server, `/api/deploy/${site}`, { method: 'POST', body: form });
  console.log(
    `${green('✓')} ${bold(site)} ${dim(`· ${info.files} ${info.files === 1 ? 'file' : 'files'} · ${humanBytes(info.bytes)} · ${Date.now() - started}ms`)}`,
  );
  console.log(`  ${cyan(info.url)}`);
  return info;
}

/** Deploy on every save — the whole "dev server" Brisk needs. */
export async function dev(dirArg: string | undefined, flags: Flags): Promise<void> {
  const dir = path.resolve(dirArg ?? '.');
  await deploy(dirArg, flags);
  console.log(dim('\nwatching for changes — ctrl-c to stop'));

  let timer: NodeJS.Timeout | null = null;
  let deploying = false;
  let dirty = false;

  const redeploy = async (): Promise<void> => {
    if (deploying) {
      dirty = true; // a save landed mid-deploy; go again when this one ends
      return;
    }
    deploying = true;
    try {
      await deploy(dirArg, flags);
    } catch (err) {
      console.error(yellow(`deploy failed: ${(err as Error).message}`));
    } finally {
      deploying = false;
      if (dirty) {
        dirty = false;
        void redeploy();
      }
    }
  };

  fs.watch(dir, { recursive: true }, (_event, file) => {
    if (!file || file.split(path.sep).some((part) => SKIP.has(part))) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(redeploy, 300);
  });
  await new Promise(() => {}); // run until interrupted
}

export async function list(flags: Flags): Promise<void> {
  const server = serverUrl(flags.server, loadConfig(process.cwd()));
  const { sites } = await api<{ sites: SiteInfo[] }>(server, '/api/sites');
  if (!sites.length) {
    console.log(`No sites yet. ${dim('Try: brisk init my-site && brisk deploy my-site')}`);
    return;
  }
  const width = Math.max(...sites.map((s) => s.name.length)) + 2;
  for (const s of sites) {
    console.log(
      `${bold(s.name.padEnd(width))}${dim(
        `${String(s.files).padStart(4)} files  ${humanBytes(s.bytes).padStart(9)}  ${timeAgo(s.updatedAt).padStart(10)}`,
      )}  ${s.updatedBy ? dim(s.updatedBy) : ''}`,
    );
  }
}

export async function open(siteArg: string | undefined, flags: Flags): Promise<void> {
  const dir = process.cwd();
  const site = siteArg ?? resolveSite(dir, flags);
  const server = serverUrl(flags.server, loadConfig(dir));
  const info = await api<SiteInfo>(server, `/api/sites/${site}`);
  console.log(cyan(info.url));
  // `start` is a cmd builtin; the empty title argument keeps URLs with & intact.
  const [cmd, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [info.url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', info.url]]
        : ['xdg-open', [info.url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

/** Download a site's source — every site on Brisk is remixable. */
export async function pull(site: string, dirArg: string | undefined, flags: Flags): Promise<void> {
  const server = serverUrl(flags.server, loadConfig(process.cwd()));
  const dir = path.resolve(dirArg ?? site);
  const { files } = await api<{ files: { path: string; size: number }[] }>(
    server,
    `/api/sites/${site}/files`,
  );
  if (!files.length) throw new Error(`no such site: ${site}`);

  for (const file of files) {
    const res = await fetch(`${server}/api/sites/${site}/raw/${file.path}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`failed to fetch ${file.path}: ${res.status}`);
    const target = path.join(dir, file.path);
    if (!target.startsWith(dir + path.sep) && target !== dir) continue;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, Buffer.from(await res.arrayBuffer()));
    console.log(`  ${green('+')} ${file.path} ${dim(humanBytes(file.size))}`);
  }
  console.log(`\n${green('✓')} pulled ${bold(site)} into ${cyan(dir)}`);
}
