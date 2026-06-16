const puppeteer = require("puppeteer-core");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.SHOT_URL || "http://127.0.0.1:5174/";
const OUT = "G:\\qiniuyun\\.trellis\\tasks\\06-15-webgl\\shots\\";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// scroll to a target progress (0..1), fighting Lenis smoothing by re-issuing a few times
async function scrollTo(page, p) {
  for (let i = 0; i < 6; i++) {
    await page.evaluate((prog) => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, prog * max);
    }, p);
    await sleep(220);
  }
  await sleep(1600); // let Lenis arrive + scene damping settle
  return page.evaluate(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? window.scrollY / max : 0;
    const sp = getComputedStyle(document.documentElement).getPropertyValue("--sp").trim();
    // try common holders for --sp too
    const holders = Array.from(document.querySelectorAll("[style*='--sp'], [class]"))
      .map((el) => getComputedStyle(el).getPropertyValue("--sp").trim())
      .filter((v) => v.length > 0);
    return { ratio: +ratio.toFixed(3), spRoot: sp, spAny: holders[0] || "", scrollH: document.documentElement.scrollHeight };
  });
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    protocolTimeout: 120000,
    args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--hide-scrollbars",
           "--no-first-run", "--no-default-browser-check", "--window-size=1296,860"],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  await sleep(5000); // lazy Scene + GLTF + settle

  const targets = [
    { p: 0.0, name: "act1-hero" },
    { p: 0.32, name: "act2a-see" },
    { p: 0.52, name: "act2b-hear" },
    { p: 0.70, name: "act2c-answer" },
    { p: 0.92, name: "act3-cta" },
  ];
  for (const t of targets) {
    const info = await scrollTo(page, t.p);
    console.log(`${t.name}: target=${t.p} readback=${JSON.stringify(info)}`);
    await page.screenshot({ path: OUT + t.name + ".png" });
    console.log("  wrote " + t.name + ".png");
  }

  // enter workspace via CTA (should be active near bottom)
  const clicked = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("button, a, [role=button]"));
    const cta = els.find((e) => (e.textContent || "").includes("开始对话"));
    if (cta) { cta.click(); return true; }
    return false;
  });
  console.log("CTA clicked:", clicked);
  await sleep(2500);
  await page.screenshot({ path: OUT + "workspace.png" });
  console.log("  wrote workspace.png");

  await browser.close();
  console.log("DONE");
})().catch((e) => { console.error("SHOT ERROR:", e.message); process.exit(1); });
