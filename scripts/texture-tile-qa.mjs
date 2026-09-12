import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL =
  process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/textures";
const ASSETS = [
  {
    file: "cinder-painted-steel-aged-v2.png",
    sha256:
      "ebf288d942b2f215f7c92c8ced8b138aaba393698b218e953bac455ae72e0893",
    maximumEdgeDelta: 12,
  },
  {
    file: "cinder-rail-ballast-aged-v2.png",
    sha256:
      "e6c506cb0ae6e051ac059f52ffd4730f27c3ec6d092b5e079620877941f3e0d3",
    maximumEdgeDelta: 32,
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
});

try {
  const results = [];
  for (const asset of ASSETS) {
    const sourcePath = `public/assets/${asset.file}`;
    const bytes = await readFile(sourcePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assert(
      sha256 === asset.sha256,
      `${asset.file} source hash changed: ${sha256}`,
    );

    const page = await browser.newPage({
      viewport: { width: 1024, height: 1024 },
      deviceScaleFactor: 1,
      colorScheme: "dark",
    });
    const assetUrl =
      `${BASE_URL.replace(/\/$/, "")}/assets/${asset.file}`;
    await page.goto(assetUrl, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    const metrics = await page.evaluate(async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Texture request failed: ${response.status}`);
      }
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", {
        willReadFrequently: true,
      });
      if (!context) throw new Error("2D canvas is unavailable.");
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let leftRight = 0;
      let topBottom = 0;
      for (let y = 0; y < canvas.height; y += 1) {
        const left = y * canvas.width * 4;
        const right = (y * canvas.width + canvas.width - 1) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          leftRight += Math.abs(
            pixels[left + channel] - pixels[right + channel],
          );
        }
      }
      for (let x = 0; x < canvas.width; x += 1) {
        const top = x * 4;
        const bottom =
          ((canvas.height - 1) * canvas.width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          topBottom += Math.abs(
            pixels[top + channel] - pixels[bottom + channel],
          );
        }
      }
      return {
        width: canvas.width,
        height: canvas.height,
        meanAbsoluteEdgeDelta: {
          leftRight: leftRight / (canvas.height * 3),
          topBottom: topBottom / (canvas.width * 3),
        },
      };
    }, assetUrl);

    assert(
      metrics.width === 1024 && metrics.height === 1024,
      `${asset.file} is not the locked 1024×1024 texture.`,
    );
    assert(
      metrics.meanAbsoluteEdgeDelta.leftRight <=
        asset.maximumEdgeDelta &&
        metrics.meanAbsoluteEdgeDelta.topBottom <=
          asset.maximumEdgeDelta,
      `${asset.file} exceeds its opposite-edge delta budget: ${JSON.stringify(metrics.meanAbsoluteEdgeDelta)}`,
    );

    await page.evaluate((url) => {
      document.body.replaceChildren();
      document.documentElement.style.width = "100%";
      document.documentElement.style.height = "100%";
      document.documentElement.style.margin = "0";
      document.body.style.width = "100%";
      document.body.style.height = "100%";
      document.body.style.margin = "0";
      document.body.style.backgroundColor = "#111";
      document.body.style.backgroundImage = `url("${url}")`;
      document.body.style.backgroundRepeat = "repeat";
      document.body.style.backgroundSize = "256px 256px";
    }, assetUrl);
    await page.waitForTimeout(500);
    const screenshotPath =
      `${OUTPUT_DIRECTORY}/${asset.file.replace(/\.png$/, "")}-tile-check.png`;
    await page.screenshot({ path: screenshotPath });
    await page.close();
    results.push({
      file: sourcePath,
      sha256,
      ...metrics,
      maximumEdgeDelta: asset.maximumEdgeDelta,
      screenshot: screenshotPath,
    });
  }

  const proof = {
    format: "cinderline-texture-tile-qa-v1",
    tileStressLayout: "4x4 at 256px per tile",
    results,
  };
  await writeFile(
    `${OUTPUT_DIRECTORY}/tile-proof.json`,
    `${JSON.stringify(proof, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({ ok: true, proof }, null, 2));
} finally {
  await browser.close();
}
