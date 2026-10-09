import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const base = process.env.BRISK_AGENT_TEST_URL || 'http://127.0.0.1:3101';
let revision = 1,
  reads = 0,
  starts = [],
  failStart = true,
  resultReads = 0;
const ctx = await browser.newContext();
async function mock(context) {
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const json = (body) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/config.json'))
      return json({ namespace: 'playground', pack: 'brisk-agent@1' });
    if (url.pathname.startsWith('/api/brisk-agent')) throw new Error('Companion API call');
    if (url.pathname === '/api/sites') {
      reads++;
      return json({
        sites: [
          { name: 'costs', updatedAt: `2026-10-0${revision}T00:00:00Z`, plugins: ['comments'] },
        ],
      });
    }
    if (url.pathname === '/api/sites/costs/files')
      return json({ files: [{ path: 'index.html', size: 100 }] });
    if (url.pathname === '/api/sites/costs/raw/index.html')
      return route.fulfill({
        contentType: 'text/html',
        body: `<title>Model costs</title><p>Terra costs fell.${revision === 2 ? ' Sonnet costs fell too.' : ''}</p>`,
      });
    if (url.pathname.startsWith('/api/db/')) return json({ docs: [] });
    if (url.pathname === '/v1/agent-runs') {
      starts.push(req.postDataJSON());
      if (failStart) {
        failStart = false;
        return route.abort();
      }
      return json({ runId: 'test-run' });
    }
    if (url.pathname.endsWith('/stream'))
      return route.fulfill({
        contentType: 'text/event-stream',
        body: 'data: {"type":"tool_call","data":{"toolName":"brisk_list_sources"}}\n\n',
      });
    if (url.pathname.endsWith('/instructions')) return json({ updateId: 'focus-1' });
    if (url.pathname.endsWith('/result')) {
      resultReads++;
      return json({
        status: resultReads > 1 ? 'RUN_STATUS_COMPLETED' : 'RUN_STATUS_RUNNING',
        output:
          resultReads > 1
            ? {
                messages: [
                  {
                    role: 'assistant',
                    content: 'Terra costs fell. https://brisk.sm-svc.com/s/costs/index.html',
                  },
                ],
              }
            : null,
      });
    }
    return route.continue();
  });
}
try {
  await mock(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(
    () => document.querySelector('#service-status').textContent === 'Agent connected',
  );
  assert.equal(reads, 0, 'Opening the page must not scan');
  await page.locator('#check-button').click();
  await page.waitForFunction(() =>
    document.querySelector('#index-status').textContent.includes('1 sites'),
  );
  await page.locator('.follow-button').first().click();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#follow-count').textContent === '1');
  assert.equal(reads, 1, 'Reload must use the saved browser index');
  await page.locator('#query').fill('Terra costs');
  await page.locator('#query').press('Enter');
  await page.waitForFunction(
    () => document.querySelector('#section-title').textContent === 'Search results',
  );
  await page.locator('#query').press('Control+Enter');
  await page.waitForFunction(() =>
    document.querySelector('#notice').textContent.includes('Failed to fetch'),
  );
  revision = 2;
  await page.locator('#check-button').click();
  await page.waitForFunction(() =>
    document.querySelector('#scan-status').textContent.includes('Last check'),
  );
  await page.locator('#ask-button').click();
  await page.waitForFunction(
    () =>
      document.querySelector('#instruction-form').hidden === false &&
      document.querySelector('#run-status').textContent === 'RUNNING',
  );
  await page.locator('#instruction').fill('Explain the cost change');
  await page.locator('#instruction-form button').click();
  await page.waitForFunction(
    () => document.querySelector('#run-status').textContent === 'COMPLETED',
  );
  assert.deepEqual(
    starts[0],
    starts[1],
    'Ambiguous start retry must preserve source snapshots and idempotency key',
  );
  await page.locator('[data-view="changes"]').click();
  await page.waitForFunction(() =>
    document.querySelector('.change-lines')?.textContent.includes('Sonnet'),
  );
  await page.screenshot({ path: '/tmp/saw-12713-browser-smoke.png', fullPage: true });
  assert.deepEqual(errors, []);
  const second = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await mock(second);
  const mobile = await second.newPage();
  await mobile.goto(base);
  await mobile.waitForFunction(
    () => document.querySelector('#service-status').textContent === 'Agent connected',
  );
  assert.equal(await mobile.locator('#follow-count').textContent(), '0');
  assert.equal(await mobile.locator('#conversation option').count(), 1);
  assert.ok((await mobile.locator('#index-status').textContent()).startsWith('0 sites'));
  await mobile.screenshot({ path: '/tmp/saw-12713-browser-mobile.png', fullPage: true });
  console.log(
    JSON.stringify({
      result: 'passed',
      cases: [
        'manual checks',
        'persistent follows and index',
        'direct platform runs',
        'stable retry',
        'focus update',
        'change comparison',
        'separate browser profiles',
        'mobile render',
      ],
      provider: 'simulated',
    }),
  );
} catch (error) {
  for (const p of ctx.pages())
    console.log(
      await p.locator('#notice').textContent(),
      await p.locator('#index-status').textContent(),
    );
  throw error;
} finally {
  await browser.close();
}
