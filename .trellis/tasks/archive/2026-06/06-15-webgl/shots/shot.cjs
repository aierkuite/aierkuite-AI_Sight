const puppeteer = require("puppeteer-core");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.SHOT_URL || "http://127.0.0.1:5174/";
const OUT = "G:\\qiniuyun\\.trellis\\tasks\\06-15-webgl\\shots\\";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function canvasInfo(page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return { hasCanvas: false };
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    let renderer = "n/a";
    try {
      const g = document.createElement("canvas").getContext("webgl");
      const ext = g && g.getExtension("WEBGL_debug_renderer_info");
      if (ext) renderer = g.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    } catch (e) {}
    return { hasCanvas: true, w: c.width, h: c.height, gl: !!gl, renderer };
  });
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false, // headful → real hardware GPU (swiftshader renders the scene blank/white)
    protocolTimeout: 120000,
    args: [
      "--ignore-gpu-blocklist",
      "--enable-gpu-rasterization",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1296,860",
    ],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  });

  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  await sleep(5000); // lazy Scene chunk + GLTF parse + several anim frames + bloom settle
  console.log("canvas(intro):", JSON.stringify(await canvasInfo(page)));
  await page.screenshot({ path: OUT + "hero.png" });
  console.log("wrote hero.png");

  const clicked = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("button, a, [role=button]"));
    const cta = els.find((e) => (e.textContent || "").includes("开始对话"));
    if (cta) { cta.click(); return cta.textContent.trim(); }
    return null;
  });
  console.log("CTA clicked:", clicked);
  await sleep(2500);
  await page.screenshot({ path: OUT + "workspace.png" });
  console.log("wrote workspace.png");

  const page2 = await browser.newPage();
  await page2.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page2.goto(URL, { waitUntil: "load", timeout: 30000 });
  await sleep(2500);
  await page2.screenshot({ path: OUT + "reduced-motion.png" });
  console.log("wrote reduced-motion.png");

  await browser.close();
  console.log("DONE");
})().catch((e) => {
  console.error("SHOT ERROR:", e.message);
  process.exit(1);
});
