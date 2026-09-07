// Re-verification capture, 2026-08-31. Same method as the 30 Aug pass:
// fresh context per subject, viewport 1512x982, load, wait 10s, capture,
// scroll to bottom, wait 5s, capture. Nothing typed or clicked.
const { chromium } = require('playwright');
const fs = require('fs');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const SUBJECTS = [
  ['docsend', 'https://docsend.com/view/58em2uebezhisqvy'],
  ['papermark', 'https://www.papermark.com/view/cmkz9p9de0014js04sf4ex5u8'],
  ['peony', 'https://app.peony.ink/view/daa6031a-a4d2-42bd-a85b-e3f1dc345b82'],
  ['stacktree', 'https://example-brand-audit.stacktr.ee/'],
  ['tiiny', 'https://ai-agents-guide.tiiny.site/'],
  ['hummingdeck', 'https://hummingdeck.com/r/mt3uu5qwv7kpxb3g'],
  ['htmlradar', 'https://htmlradar.com/r/lumenforge-demo'],
];

const OUT = __dirname + '/recapture';
fs.mkdirSync(OUT, { recursive: true });

async function probe(page, label) {
  return page.evaluate(() => {
    const g = (fn) => {
      try {
        return fn();
      } catch (e) {
        return 'THREW ' + e.name + ': ' + e.message;
      }
    };
    return {
      href: location.href,
      origin: g(() => window.origin),
      cookie: g(() => document.cookie),
      localStorage: g(() => Object.keys(localStorage)),
      sessionStorage: g(() => Object.keys(sessionStorage)),
      scripts: g(() => [...document.querySelectorAll('script[src]')].map((s) => s.src)),
      iframes: g(() => [...document.querySelectorAll('iframe')].map((f) => f.src)),
      textHead: g(() => (document.body ? document.body.innerText.slice(0, 1200) : '')),
    };
  });
}

(async () => {
  for (const [name, url] of SUBJECTS) {
    const started = new Date().toISOString();
    const browser = await chromium.launch({ headless: true, channel: 'chromium' });
    const ctx = await browser.newContext({
      viewport: { width: 1512, height: 982 },
      userAgent: UA,
    });
    const page = await ctx.newPage();
    const reqs = [];
    page.on('request', (r) => reqs.push({ n: reqs.length + 1, m: r.method(), u: r.url() }));
    page.on('response', (r) => {
      const e = reqs.find((x) => x.u === r.url() && x.s === undefined);
      if (e) e.s = r.status();
    });
    page.on('requestfailed', (r) => {
      const e = reqs.find((x) => x.u === r.url() && x.s === undefined);
      if (e) e.s = 'FAILED ' + (r.failure() ? r.failure().errorText : '?');
    });

    let nav = null;
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      nav = resp ? resp.status() : null;
    } catch (e) {
      nav = 'NAV ERROR: ' + e.message;
    }
    await page.waitForTimeout(10000);
    const afterLoad = await probe(page, 'load');
    await page.evaluate(() => window.scrollTo(0, document.body ? document.body.scrollHeight : 0));
    await page.waitForTimeout(5000);
    const afterScroll = await probe(page, 'scroll');

    const hosts = {};
    for (const r of reqs) {
      let h;
      try {
        h = new URL(r.u).host;
      } catch {
        h = '(unparseable)';
      }
      hosts[h] = (hosts[h] || 0) + 1;
    }

    fs.writeFileSync(
      `${OUT}/${name}.json`,
      JSON.stringify(
        { name, url, started, finished: new Date().toISOString(), nav, hosts, total: reqs.length, reqs, afterLoad, afterScroll },
        null,
        1
      )
    );
    console.log(`${name}: nav=${nav} requests=${reqs.length} hosts=${Object.keys(hosts).length} final=${afterLoad.href}`);
    await browser.close();
  }
})();
