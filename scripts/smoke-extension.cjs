/* Isolated Chrome profile and dead proxy: never contacts or changes production systems. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const started = Date.now();
  const root = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-layout-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${root}`, `--load-extension=${root}`,
        '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
      ],
    });
    await context.setOffline(true);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const modules = await worker.evaluate(() => ({
      core: typeof Detection.sample, fs: typeof FsSwitch.plans,
      cdr: typeof Cdr, history: typeof HistoryDB,
      rotation: typeof processSwitch, evening: typeof runCollectionEvening,
      configured: !!globalThis.SupabaseHistoryConfig?.historyToken,
      cloud: typeof globalThis.CloudHistory?.flush, remote: typeof globalThis.TelegramBridge?.snapshot,
    }));
    assert.equal(modules.core, 'function');
    assert.equal(modules.fs, 'function');
    assert.notEqual(modules.cdr, 'undefined');
    assert.notEqual(modules.history, 'undefined');
    assert.equal(modules.rotation, 'function');
    assert.equal(modules.evening, 'function');
    if (modules.configured) {
      assert.equal(modules.cloud, 'function', 'Configured cloud history must load from the new config path');
      assert.equal(modules.remote, 'function', 'Configured remote bridge must load');
    }
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.name));
    await page.goto(`chrome-extension://${extensionId}/src/ui/dashboard.html`);
    await page.waitForFunction(() => typeof render === 'function' && typeof HistoryExport !== 'undefined' && typeof FsSwitch !== 'undefined');
    const response = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATE' }));
    assert.ok(response?.state, 'Dashboard must communicate with the actual worker');
    assert.equal(await page.locator('h1').textContent(), 'AUTO CALL MONITOR');
    assert.deepEqual(pageErrors, [], 'Dashboard must load without JavaScript errors');
    console.log(`Browser: 1 passed, 0 failed, ${((Date.now() - started) / 1000).toFixed(2)}s`);
  } finally {
    if (context) await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('Browser smoke failed:', error.message);
  process.exitCode = 1;
});
