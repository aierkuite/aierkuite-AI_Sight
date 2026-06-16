const puppeteer = require("puppeteer-core");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = "https://hashgraphvc-static.pages.dev/";
const OUT = "G:\\qiniuyun\\.trellis\\tasks\\06-15-webgl\\shots\\ref\\";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrollTo(page, p) {
  for (let i = 0; i < 6; i++) {
    await page.evaluate((prog) => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, prog * max);
    }, p);
    await sleep(260);
  }
  await sleep(1900);
  return page.evaluate(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return { ratio: max > 0 ? +(window.scrollY / max).toFixed(3) : 0, scrollH: document.documentElement.scrollHeight };
  });
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    protocolTimeout: 180000,
    args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--hide-scrollbars",
           "--no-first-run", "--no-default-browser-check", "--window-size=1296,860"],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  console.log("loading reference site...");
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 }).catch((e) => console.log("goto note:", e.message));
  await sleep(7000); // WebGL + assets warm up

  const targets = [0.0, 0.12, 0.25, 0.4, 0.55, 0.7, 0.85, 0.97];
  for (let i = 0; i < targets.length; i++) {
    const info = await scrollTo(page, targets[i]);
    const name = `ref-${String(i).padStart(2, "0")}-p${Math.round(targets[i] * 100)}`;
    await page.screenshot({ path: OUT + name + ".png" });
    console.log(`${name}: ${JSON.stringify(info)}  wrote`);
  }
  await browser.close();
  console.log("DONE");
})().catch((e) => { console.error("SHOT ERROR:", e.message); process.exit(1); });
