import { BriskSource } from './content.js';
import { Store } from './store.js';
import { Scanner } from './scanner.js';
import { AgentPlatform, finalText } from './platform.js';
let store, scanner, platform;
const $ = (id) => document.getElementById(id);
const profile = localStorage.getItem('brisk-agent-profile') || crypto.randomUUID();
localStorage.setItem('brisk-agent-profile', profile);
const state = {
  view: 'discover',
  follows: [],
  agentReady: false,
  run: null,
  controller: null,
  render: 0,
};
function saved(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
let conversations = saved('brisk-agent-conversations', []);
if (!Array.isArray(conversations)) conversations = [];
let current = localStorage.getItem('brisk-agent-conversation');
function conversation() {
  return conversations.find((c) => c.id === current);
}
function saveConversations() {
  localStorage.setItem('brisk-agent-conversations', JSON.stringify(conversations.slice(-15)));
  localStorage.setItem('brisk-agent-conversation', current);
  $('conversation').replaceChildren(
    ...conversations
      .slice()
      .reverse()
      .map((c) => {
        const option = el('option', c.title);
        option.value = c.id;
        option.selected = c.id === current;
        return option;
      }),
  );
}
function newConversation() {
  current = crypto.randomUUID();
  conversations.push({ id: current, title: 'New conversation', messages: [] });
  conversations = conversations.slice(-15);
  saveConversations();
  $('agent-panel').hidden = true;
  $('query').value = '';
}
if (!conversation()) newConversation();
else saveConversations();
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}
async function api(path, options = {}) {
  const url = new URL(path, location.origin);
  if (url.pathname === '/status') return { ...store.stats(), agentReady: platform.ready };
  if (url.pathname === '/search') return { results: store.search(url.searchParams.get('q') ?? '') };
  if (url.pathname === '/discover') return { results: store.discover(state.follows) };
  if (url.pathname === '/changes')
    return { changes: store.changes(state.follows, url.searchParams.get('all') === 'true') };
  if (url.pathname === '/runs') {
    const input = JSON.parse(options.body);
    const runId = await platform.start(
      input.question,
      input.sources,
      input.requestId,
      input.history,
      input.coverage,
    );
    return { runId };
  }
  const run = url.pathname.match(/^\/runs\/([a-zA-Z0-9-]{1,80})(\/instructions)?$/);
  if (run?.[2]) {
    const input = JSON.parse(options.body);
    return platform.instruct(run[1], input.content, input.requestId);
  }
  if (run) {
    const result = await platform.result(run[1]);
    const c = conversations.find((c) => c.runId === run[1]);
    return {
      ...result,
      output: { text: finalText(result), error: result.error },
      sources: c?.sources ?? [],
    };
  }
  throw new Error('Unknown browser operation');
}
async function checkSources() {
  $('check-button').disabled = true;
  notice('');
  $('scan-status').textContent = 'Checking Brisk sources…';
  try {
    await scanner.scan();
    await status();
    await render();
  } finally {
    $('check-button').disabled = false;
  }
}
const stamp = (value) =>
  value
    ? new Date(value).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Not checked';
function sourceLink(url, text) {
  const link = el('a', text);
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'brisk.sm-svc.com' || parsed.hostname.endsWith('.brisk.sm-svc.com'))
    ) {
      link.href = parsed.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  } catch {
    /* Render invalid links as text. */
  }
  return link;
}
function empty(title, help) {
  const box = el('div', undefined, 'empty');
  box.append(el('strong', title), el('span', help));
  $('results').replaceChildren(box);
}
async function follows() {
  const values = saved('brisk-agent-follows', []);
  state.follows = Array.isArray(values)
    ? values
        .filter((f) => ['site', 'topic'].includes(f.kind) && typeof f.value === 'string')
        .slice(0, 50)
    : [];
  $('follow-count').textContent = state.follows.length;
}
const followQuery = () => `follows=${encodeURIComponent(JSON.stringify(state.follows))}`;
const followed = (kind, value) => state.follows.some((f) => f.kind === kind && f.value === value);
async function toggleFollow(kind, value) {
  if (followed(kind, value))
    state.follows = state.follows.filter((f) => f.kind !== kind || f.value !== value);
  else {
    if (state.follows.length >= 50) throw new Error('You can follow up to 50 sites and topics.');
    state.follows.push({ kind, value });
  }
  localStorage.setItem('brisk-agent-follows', JSON.stringify(state.follows));
  await follows();
  await render();
}
function card(row) {
  const item = el('article', undefined, 'card');
  const top = el('div', undefined, 'card-top');
  top.append(
    el('span', row.site, 'site-label'),
    el('span', row.path === '@comments' ? 'COMMENTS' : 'PAGE'),
  );
  const heading = el('h3');
  heading.append(sourceLink(row.url, row.title));
  item.append(top, heading, el('p', row.excerpt));
  item.append(el('div', row.reason || `Checked ${stamp(row.checked)}`, 'reason'));
  const actions = el('div', undefined, 'card-actions');
  const follow = el(
    'button',
    followed('site', row.site) ? '✓ Following' : '+ Follow site',
    `follow-button${followed('site', row.site) ? ' active' : ''}`,
  );
  follow.onclick = () => toggleFollow('site', row.site).catch((e) => notice(e.message));
  actions.append(sourceLink(row.url, 'Read source ↗'), follow);
  item.append(actions);
  return item;
}
const copy = {
  discover: [
    'Find your next useful read.',
    'Search your team’s work. Follow the subjects that matter to you.',
    'Worth a look',
    'Sources selected from your topics and followed sites.',
  ],
  search: [
    'A good answer starts here.',
    'Search page text and published comments across Brisk.',
    'Search results',
    'Matches include a source link and an excerpt.',
  ],
  following: [
    'Keep your interests close.',
    'Follow a site or topic. Use Check sources to compare changes.',
    'Your follows',
    'These selections belong to this browser profile.',
  ],
  changes: [
    'See what moved forward.',
    'Review changes observed since the first saved snapshot.',
    'Recent changes',
    'Page and comment comparisons. History covers the last 30 days.',
  ],
};
async function render() {
  const revision = ++state.render;
  const [heading, subheading, title, caption] = copy[state.view];
  $('heading').textContent = heading;
  $('subheading').textContent = subheading;
  $('section-title').textContent = title;
  $('section-caption').textContent = caption;
  $('view-name').textContent = state.view.toUpperCase();
  document.querySelectorAll('[data-view]').forEach((b) => {
    b.classList.toggle('selected', b.dataset.view === state.view);
    b.setAttribute('aria-current', b.dataset.view === state.view ? 'page' : 'false');
  });
  $('follow-form').hidden = state.view !== 'following';
  $('changes-filter').hidden = state.view !== 'changes';
  let rows;
  if (state.view === 'following') rows = state.follows;
  else if (state.view === 'changes')
    rows = (await api(`/changes?all=${$('all-changes').checked}&${followQuery()}`)).changes;
  else
    rows = (
      await api(
        state.view === 'search'
          ? `/search?q=${encodeURIComponent($('query').value)}`
          : `/discover?${followQuery()}`,
      )
    ).results;
  if (revision !== state.render) return;
  $('result-count').textContent =
    `${rows.length} ${state.view === 'following' ? 'follows' : state.view === 'changes' ? 'changes' : 'sources'}`;
  if (!rows.length) {
    if (state.view === 'changes')
      return empty(
        'No changes to show yet.',
        'Follow sites or topics. Use Check sources to compare content with this browser’s saved baseline.',
      );
    if (state.view === 'following')
      return empty(
        'Start with one interest.',
        'Follow a topic above, or follow a site from a search result.',
      );
    return empty('No matching sources.', 'Use Check sources first, then try a shorter topic.');
  }
  $('results').replaceChildren(
    ...rows.map((row) => {
      if (state.view === 'following') {
        const box = el('article', undefined, 'card follow-card');
        const info = el('div');
        info.append(el('div', row.kind.toUpperCase(), 'site-label'), el('h3', row.value));
        const remove = el('button', 'Unfollow', 'secondary');
        remove.onclick = () => toggleFollow(row.kind, row.value).catch((e) => notice(e.message));
        box.append(info, remove);
        return box;
      }
      if (state.view === 'changes') {
        const box = el('article', undefined, 'card');
        const top = el('div', undefined, 'card-top');
        top.append(
          el('span', row.kind.toUpperCase(), 'site-label'),
          el('span', stamp(row.observed)),
        );
        const title = el('h3');
        title.append(sourceLink(row.url, row.title));
        box.append(top, title);
        const list = el('ul', undefined, 'change-lines');
        for (const t of row.data.added) list.append(el('li', `Added: ${t}`));
        for (const t of row.data.removed) list.append(el('li', `Removed: ${t}`, 'removed'));
        box.append(list, sourceLink(row.url, 'Open source ↗'));
        return box;
      }
      return card(row);
    }),
  );
}
async function status() {
  const data = await api('/status');
  state.agentReady = data.agentReady;
  $('ask-button').disabled = !data.agentReady || Boolean(state.run);
  $('service-status').textContent = data.agentReady ? 'Agent connected' : 'Search connected';
  $('scan-status').textContent = data.scan?.running
    ? 'Scanning Brisk…'
    : `Last check ${stamp(data.scan?.finished)}`;
  $('index-status').textContent =
    `${data.sites} sites · ${data.documents} sources · Manual checks only`;
  $('change-count').textContent = (await api(`/changes?${followQuery()}`)).changes.length;
  const incomplete = (data.scan?.errors?.length ?? 0) + (data.scan?.partialSites?.length ?? 0);
  if (incomplete)
    notice(`${incomplete} checks have incomplete coverage. Some source text is missing.`);
}
function inlineMarkdown(text) {
  const fragment = document.createDocumentFragment();
  const pattern =
    /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s)<>]+))/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    fragment.append(document.createTextNode(text.slice(cursor, match.index)));
    if (match[2] || match[3]) {
      const strong = document.createElement('strong');
      strong.textContent = match[2] || match[3];
      fragment.append(strong);
    } else if (match[4]) {
      const code = document.createElement('code');
      code.textContent = match[4];
      fragment.append(code);
    } else if (match[5] && match[6]) {
      fragment.append(sourceLink(match[6], match[5]));
    } else {
      fragment.append(sourceLink(match[7], match[7]));
    }
    cursor = match.index + match[0].length;
  }
  fragment.append(document.createTextNode(text.slice(cursor)));
  return fragment;
}
function answerText(text) {
  const fragment = document.createDocumentFragment();
  const lines = String(text).split('\n');
  let list;
  const closeList = () => {
    if (list) {
      fragment.append(list);
      list = null;
    }
  };
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (heading) {
      closeList();
      const h = document.createElement('h3');
      h.append(inlineMarkdown(heading[1]));
      fragment.append(h);
      continue;
    }
    if (bullet || numbered) {
      if (!list || list.tagName.toLowerCase() !== (bullet ? 'ul' : 'ol')) {
        closeList();
        list = document.createElement(bullet ? 'ul' : 'ol');
      }
      const item = document.createElement('li');
      item.append(inlineMarkdown((bullet || numbered)[1]));
      list.append(item);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    const paragraph = document.createElement('p');
    paragraph.append(inlineMarkdown(line));
    fragment.append(paragraph);
  }
  closeList();
  $('answer').replaceChildren(fragment);
}
async function progress(id, signal) {
  const response = await platform.events(id, signal);
  if (!response.ok)
    throw new Error('Live progress is unavailable. The run status will still update.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
    if (pending.length > 2_000_000) throw new Error('Progress event exceeded its size limit');
    let split;
    while ((split = pending.indexOf('\n\n')) >= 0) {
      const chunk = pending.slice(0, split);
      pending = pending.slice(split + 2);
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n');
      if (!data) continue;
      try {
        const event = JSON.parse(data);
        const kind = event.type || event.eventType || 'Run event';
        const details = event.data || {};
        const label = details.toolName || details.tool_name || details.model?.id || '';
        const list = $('progress');
        list.append(el('li', `${String(kind).replaceAll('_', ' ')}${label ? ` · ${label}` : ''}`));
        while (list.children.length > 80) list.firstChild.remove();
      } catch {
        /* Ignore SSE keepalive data. */
      }
    }
  }
}
async function watchRun(id) {
  state.run = id;
  localStorage.setItem('brisk-agent-run', id);
  $('agent-panel').hidden = false;
  $('instruction-form').hidden = false;
  $('ask-button').disabled = true;
  $('conversation').disabled = true;
  $('new-conversation').disabled = true;
  state.controller?.abort();
  state.controller = new AbortController();
  void progress(id, state.controller.signal).catch((e) => {
    if (e.name !== 'AbortError') notice(e.message);
  });
  try {
    while (state.run === id) {
      const run = await api(`/runs/${id}`);
      $('run-status').textContent = run.status.replace('RUN_STATUS_', '');
      if (run.output?.text) answerText(run.output.text);
      $('answer-sources').replaceChildren(...run.sources.map((s) => sourceLink(s.url, s.title)));
      if (/COMPLETED|FAILED|CANCELLED|CANCELED|TIMED_OUT|EXPIRED/.test(run.status)) {
        if (!run.output?.text)
          $('answer').textContent = run.output?.error || 'The run ended without an answer.';
        const c = conversations.find((c) => c.runId === id) ?? conversation();
        if (!c.messages.some((m) => m.runId === id && m.role === 'assistant'))
          c.messages.push({
            role: 'assistant',
            text: $('answer').textContent.slice(0, 8000),
            runId: id,
          });
        c.messages = c.messages.slice(-20);
        delete c.runId;
        saveConversations();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } finally {
    state.run = null;
    state.controller.abort();
    $('instruction-form').hidden = true;
    $('ask-button').disabled = !state.agentReady;
    $('conversation').disabled = false;
    $('new-conversation').disabled = false;
  }
}
async function ask() {
  if (!$('query').value.trim()) return $('query').focus();
  notice('');
  $('ask-button').disabled = true;
  $('agent-panel').hidden = false;
  $('answer').textContent = 'Gathering sources…';
  $('progress').replaceChildren();
  const c = conversation();
  const question = $('query').value.trim();
  if (!c.pending || c.pending.question !== question)
    c.pending = {
      question,
      requestId: crypto.randomUUID(),
      sources: store.snapshot(question),
      coverage: {
        ...store.stats(),
        limits:
          '10 files per site, 12000 characters per file, 1500 sources total. Manual browser checks only.',
      },
      history: c.messages.slice(-6).map(({ role, text }) => ({ role, text: text.slice(0, 4000) })),
    };
  saveConversations();
  const { runId } = await api('/runs', { method: 'POST', body: JSON.stringify(c.pending) });
  c.sources = c.pending.sources.map(({ id, title, url }) => ({ id, title, url }));
  c.title = question.slice(0, 42);
  c.messages.push({ role: 'user', text: question, runId });
  c.runId = runId;
  delete c.pending;
  saveConversations();
  await watchRun(runId);
}
document.querySelectorAll('[data-view]').forEach(
  (b) =>
    (b.onclick = () => {
      state.view = b.dataset.view;
      render().catch((e) => notice(e.message));
    }),
);
document.querySelectorAll('[data-query]').forEach(
  (b) =>
    (b.onclick = () => {
      $('query').value = b.dataset.query;
      state.view = 'search';
      render().catch((e) => notice(e.message));
    }),
);
$('search-form').onsubmit = (event) => {
  event.preventDefault();
  state.view = 'search';
  render().catch((e) => notice(e.message));
};
$('ask-button').onclick = () =>
  ask().catch((e) => {
    notice(e.message);
    $('ask-button').disabled = !state.agentReady;
  });
$('query').onkeydown = (event) => {
  if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
  event.preventDefault();
  ask().catch((e) => {
    notice(e.message);
    $('ask-button').disabled = !state.agentReady;
  });
};
$('check-button').onclick = () => checkSources().catch((e) => notice(e.message));
$('all-changes').onchange = () => render().catch((e) => notice(e.message));
$('follow-form').onsubmit = async (event) => {
  event.preventDefault();
  try {
    const kind = $('follow-kind').value,
      value = $('follow-value').value.trim();
    if (!value) return;
    if (!followed(kind, value)) await toggleFollow(kind, value);
    $('follow-value').value = '';
  } catch (e) {
    notice(e.message);
  }
};
$('instruction-form').onsubmit = async (event) => {
  event.preventDefault();
  if (!state.run) return;
  try {
    await api(`/runs/${state.run}/instructions`, {
      method: 'POST',
      body: JSON.stringify({ content: $('instruction').value, requestId: crypto.randomUUID() }),
    });
    $('instruction').value = '';
    notice('The agent will apply your focus update on its next turn.');
  } catch (e) {
    notice(e.message);
  }
};
$('new-conversation').onclick = () => newConversation();
$('conversation').onchange = () => {
  current = $('conversation').value;
  saveConversations();
  const c = conversation();
  const last = [...c.messages].reverse().find((m) => m.role === 'assistant');
  $('agent-panel').hidden = !last;
  if (last) {
    answerText(last.text);
    $('run-status').textContent = 'Saved answer';
    $('instruction-form').hidden = true;
    $('answer-sources').replaceChildren();
    $('progress').replaceChildren();
  }
  if (c.runId) void watchRun(c.runId).catch((e) => notice(e.message));
};
async function init() {
  store = await Store.open();
  scanner = new Scanner(store, new BriskSource(location.origin));
  const response = await fetch('./config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Agent configuration is unavailable');
  const config = await response.json();
  platform = new AgentPlatform({ origin: location.origin, ...config });
  await follows();
  await status();
  await render();
  const c = conversation();
  if (c.runId) void watchRun(c.runId).catch((e) => notice(e.message));
}
void init().catch((e) => {
  notice(e.message);
  $('service-status').textContent = 'Connection failed';
  empty('The service is unavailable.', 'Reload after the connection is restored.');
});
