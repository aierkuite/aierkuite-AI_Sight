const puppeteer = require("puppeteer-core");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.SHOT_URL || "http://127.0.0.1:5173/";
const OUT = "G:\\qiniuyun\\.trellis\\tasks\\06-15-webgl\\shots\\";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    protocolTimeout: 120000,
    args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--hide-scrollbars",
           "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required",
           "--window-size=1296,860"],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  });

  // ---- Desktop Hero: fonts + SoundToggle ----
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  await sleep(5000);
  const fontCheck = await page.evaluate(() => ({
    parabole: document.fonts.check('700 48px "Parabole"'),
    ppnm: document.fonts.check('600 16px "PP Neue Montreal"'),
    titleFont: getComputedStyle(document.querySelector("h1")).fontFamily,
  }));
  console.log("fonts:", JSON.stringify(fontCheck));
  await page.screenshot({ path: OUT + "p3-hero-desktop.png" });
  console.log("wrote p3-hero-desktop.png");

  // SoundToggle: present + aria-pressed flips on click (§12-5 user-gesture path)
  const before = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label*="氛围音"]');
    return b ? b.getAttribute("aria-pressed") : "MISSING";
  });
  await page.evaluate(() => {
    const b = document.querySelector('button[aria-label*="氛围音"]');
    if (b) b.click();
  });
  await sleep(600);
  const after = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label*="氛围音"]');
    return b ? b.getAttribute("aria-pressed") : "MISSING";
  });
  console.log(`soundToggle aria-pressed: before=${before} after=${after}`);
  await page.screenshot({ path: OUT + "p3-hero-soundon.png" });
  console.log("wrote p3-hero-soundon.png");
  await page.close();

  // ---- Mobile (narrow + coarse pointer → mobile quality preset + layout) ----
  const m = await browser.newPage();
  await m.emulate({
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  });
  await m.goto(URL, { waitUntil: "load", timeout: 30000 });
  await sleep(5000);
  await m.screenshot({ path: OUT + "p3-mobile-hero.png" });
  console.log("wrote p3-mobile-hero.png");
  // scroll to a mid act on mobile to check layout doesn't overflow
  await m.evaluate(() => window.scrollTo(0, 0.5 * (document.documentElement.scrollHeight - window.innerHeight)));
  await sleep(1800);
  await m.screenshot({ path: OUT + "p3-mobile-act.png" });
  console.log("wrote p3-mobile-act.png");
  await m.close();

  // ---- reduced-motion (native scroll, 2D fallback, text readable) ----
  const r = await browser.newPage();
  await r.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await r.goto(URL, { waitUntil: "load", timeout: 30000 });
  await sleep(3000);
  await r.screenshot({ path: OUT + "p3-reduced-hero.png" });
  await r.evaluate(() => window.scrollTo(0, 0.5 * (document.documentElement.scrollHeight - window.innerHeight)));
  await sleep(1500);
  await r.screenshot({ path: OUT + "p3-reduced-act.png" });
  console.log("wrote p3-reduced-*.png");
  await r.close();

  await browser.close();
  console.log("DONE");
})().catch((e) => { console.error("SHOT ERROR:", e.message); process.exit(1); });
