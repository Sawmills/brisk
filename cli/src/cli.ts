#!/usr/bin/env node
import { parseArgs } from 'node:util';
import * as commands from './commands.js';
import { bold, cyan, dim, yellow } from './ui.js';

const HELP = `${bold('brisk')} — drop a folder, get a site

${bold('Usage')}
  brisk init [name]            scaffold a new site folder
  brisk deploy [dir]           upload a folder, get a URL
  brisk dev [dir]              deploy on every file change
  brisk list                   all sites on the server
  brisk open [site]            open a site in the browser
  brisk pull <site> [dir]      download a site's source to remix it

${bold('Options')}
  --site <name>                override the site name (default: brisk.json or folder name)
  --server <url>               Brisk server (default: $BRISK_SERVER, brisk.json, or http://localhost:8787)

${bold('Environment')}
  BRISK_SERVER                 default server URL
  BRISK_TOKEN                  bearer token, needed when the server runs with AUTH=google
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      site: { type: 'string' },
      server: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  const [command, ...args] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return;
  }

  const flags = { site: values.site, server: values.server };
  switch (command) {
    case 'init':
      return commands.init(args[0], flags);
    case 'deploy':
      await commands.deploy(args[0], flags);
      return;
    case 'dev':
      return commands.dev(args[0], flags);
    case 'list':
    case 'ls':
      return commands.list(flags);
    case 'open':
      return commands.open(args[0], flags);
    case 'pull':
      if (!args[0]) throw new Error('usage: brisk pull <site> [dir]');
      return commands.pull(args[0], args[1], flags);
    default:
      console.log(`${yellow('unknown command:')} ${command}\n\n${HELP}`);
      process.exitCode = 1;
  }
}

main().catch((err: Error) => {
  console.error(`${yellow('error:')} ${err.message}`);
  if (err.message.includes('ECONNREFUSED')) {
    console.error(dim(`is the Brisk server running? try ${cyan('pnpm dev')} or set --server`));
  }
  process.exitCode = 1;
});
