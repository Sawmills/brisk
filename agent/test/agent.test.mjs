import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../site/store.js';
import { Scanner } from '../site/scanner.js';
import { BriskSource, extractContent } from '../site/content.js';
import { AgentPlatform } from '../site/platform.js';
import pack, { capabilities } from '../pack/bundle.mjs';

function fixture() {
  const store = new Store();
  const data = {
    sites: [{ name: 'costs', updatedAt: '2026-10-01T00:00:00Z', plugins: ['comments'] }],
    html: '<title>Model costs</title><h1>Terra costs fell.</h1>',
    comments: [],
    fail: false,
  };
  const source = {
    origin: 'https://brisk.sm-svc.com',
    sites: async () => data.sites,
    files: async () => [{ path: 'index.html', size: 500 }],
    document: async () => {
      if (data.fail) throw new Error('Unavailable');
      return data.html;
    },
    comments: async () => ({ docs: data.comments, capped: false }),
  };
  const scanner = new Scanner(store, source);
  return { store, data, scanner };
}

test('index, comment-only changes, page changes, no-op scans, and failed reads preserve evidence', async () => {
  const { store, data, scanner } = fixture();
  try {
    await scanner.scan();
    assert.equal(store.search('Terra')[0].title, 'Model costs');
    assert.equal(store.changes([], true).length, 0);
    data.comments = [{ id: 'one', text: 'Please compare Sonnet.', status: 'open' }];
    await scanner.scan();
    assert.equal(store.changes([], true).length, 1);
    assert.equal(store.search('Sonnet')[0].path, '@comments');
    await scanner.scan();
    assert.equal(store.changes([], true).length, 1);
    data.sites[0].updatedAt = '2026-10-02T00:00:00Z';
    data.html = '<title>Model costs</title><p>Terra costs fell. Sonnet costs fell too.</p>';
    await scanner.scan();
    assert.equal(store.changes([{ kind: 'topic', value: 'Sonnet' }]).length, 2);
    data.sites[0].updatedAt = '2026-10-03T00:00:00Z';
    data.fail = true;
    await scanner.scan();
    assert.ok(store.site('costs').error);
    assert.ok(store.search('Terra').length);
    assert.equal(store.changes([], true).length, 2);
    data.sites = [];
    await scanner.scan();
    assert.equal(store.search('Terra').length, 0);
    assert.equal(store.sites().length, 0);
  } finally {
    // Browser store has no server resource.
  }
});

test('source extraction removes scripts, search accepts FTS syntax as text, and snapshots stay fixed', async () => {
  const { store, data, scanner } = fixture();
  try {
    data.html =
      '<title>Costs &amp; routing</title><script>steal()</script><style>secret</style><p>Terra uses less.</p>';
    await scanner.scan();
    const snap = store.snapshot('Terra');
    assert.equal(snap.length, 1);
    assert.doesNotMatch(snap[0].text, /steal|secret/);
    assert.doesNotThrow(() => store.search('" OR * NEAR(terra) --'));
    data.html = '<title>New</title><p>A changed source.</p>';
    data.sites[0].updatedAt = '2026-10-03';
    await scanner.scan();
    assert.match(snap[0].text, /Terra/);
    assert.equal(extractContent('<p>hello &#x110000;</p>', 'x.html').text, 'hello');
  } finally {
    // Browser store has no server resource.
  }
});

test('invalid inventory cannot delete saved sources', async () => {
  const { store, scanner } = fixture();
  await scanner.scan();
  const source = new BriskSource('https://brisk.sm-svc.com', async () =>
    Response.json({ sites: [{}] }),
  );
  await assert.rejects(new Scanner(store, source).scan(), /Invalid Brisk site inventory/);
  assert.equal(store.search('Terra').length, 1);
  const restored = new Store(structuredClone(store.data));
  assert.equal(restored.search('Terra')[0].title, 'Model costs');
  assert.equal(typeof scanner.start, 'undefined');
});

test('pack reports actual capabilities and reads only sources bound to its input', async () => {
  const agent = pack.agents['brisk-agent'];
  const tools = Object.fromEntries(agent.tools.map((t) => [t.name, t]));
  assert.equal(capabilities().discovery.classifierAvailable, false);
  assert.equal(capabilities().changes.scheduled, false);
  assert.equal(capabilities().changes.runsWhilePageClosed, false);
  assert.equal((await tools.brisk_capabilities.execute()).follows.agentCanWriteFollows, false);
  assert.equal(tools.brisk_read_source.deferred, true);
  assert.equal(agent.modelRouting.select({ turn: 1 }).candidateKey, 'gather');
  assert.equal(agent.modelRouting.select({ turn: 3 }).candidateKey, 'explain');
  const ctx = {
    runInput: { sources: [{ id: 'costs/index.html', text: 'Costs fell.' }] },
    http: async () => {
      throw new Error('Snapshot reads must not call a server');
    },
  };
  await assert.rejects(
    tools.brisk_read_source.execute(ctx, { id: 'outside/index.html' }),
    /outside this run/,
  );
  assert.equal(
    (await tools.brisk_read_source.execute(ctx, { id: 'costs/index.html' })).text,
    'Costs fell.',
  );
});

test('Agent Platform wire request pins the pack and bounds runtime without taking client namespace', async () => {
  let request;
  const platform = new AgentPlatform({
    origin: 'http://platform',
    namespace: 'playground',
    pack: 'brisk-agent@1',
    fetcher: async (url, init) => {
      request = { url: String(url), ...init };
      return Response.json({ runId: 'run-id' });
    },
  });
  await platform.start('question', [], 'request-id');
  const input = JSON.parse(request.body);
  assert.equal(input.service, 'brisk-agent@1');
  assert.equal(input.executionPolicy.startToClose, '180s');
  assert.equal(request.headers['x-namespace'], 'playground');
});

test('source listing returns metadata without changing the frozen input', async () => {
  const agent = pack.agents['brisk-agent'];
  const input = {
    question: 'Compare costs',
    sources: [{ id: 'costs/index.html', text: 'Frozen body', title: 'Costs' }],
  };
  const listed = await agent.tools
    .find((t) => t.name === 'brisk_list_sources')
    .execute({ runInput: input });
  assert.equal(listed.sources[0].text, undefined);
  assert.equal(input.sources[0].text, 'Frozen body');
});
