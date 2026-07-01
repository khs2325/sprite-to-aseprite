import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { build } from "vite";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CANONICAL_HOME_URL = "https://sprite-to-aseprite.pages.dev/";
const SITEMAP_URL = "https://sprite-to-aseprite.pages.dev/sitemap.xml";

type StaticAsset = {
  bytes: Buffer;
  text: string;
};

async function readStaticAsset(filePath: string): Promise<StaticAsset> {
  const bytes = await readFile(filePath);
  return { bytes, text: bytes.toString("utf8") };
}

function expectNoUtf8Bom({ bytes }: StaticAsset): void {
  expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
}

function expectValidSitemap(asset: StaticAsset): void {
  expectNoUtf8Bom(asset);
  expect(asset.bytes[0]).toBe("<".charCodeAt(0));
  expect(asset.text.startsWith("<?xml")).toBe(true);
  expect(asset.text).toContain(
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  );
  expect(asset.text.trim().endsWith("</urlset>")).toBe(true);

  const locations = [...asset.text.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(
    ([, location]) => location,
  );
  expect(locations.length).toBeGreaterThan(0);
  expect(locations).toContain(CANONICAL_HOME_URL);
}

function expectValidRobots(asset: StaticAsset): void {
  expectNoUtf8Bom(asset);
  expect(asset.text).toContain("User-agent: *");
  expect(asset.text).toContain("Allow: /");
  expect(asset.text).toContain(`Sitemap: ${SITEMAP_URL}`);
  expect(asset.text).not.toMatch(/^Disallow:\s*\/\s*$/imu);
}

describe("static SEO assets", () => {
  it("keeps the public sitemap parseable and free of a UTF-8 BOM", async () => {
    const sitemap = await readStaticAsset(
      path.join(ROOT, "public", "sitemap.xml"),
    );

    expectValidSitemap(sitemap);
  });

  it("keeps the public robots.txt crawlable and pointed at the sitemap", async () => {
    const robots = await readStaticAsset(
      path.join(ROOT, "public", "robots.txt"),
    );

    expectValidRobots(robots);
  });

  it("preserves sitemap.xml and robots.txt in the production build", async () => {
    const outDir = path.join(
      ROOT,
      "tmp",
      `static-seo-assets-${process.pid}`,
    );

    try {
      await build({
        configFile: false,
        logLevel: "silent",
        publicDir: "public",
        root: ROOT,
        build: {
          emptyOutDir: true,
          outDir,
          target: "es2022",
        },
      });

      const publicSitemap = await readStaticAsset(
        path.join(ROOT, "public", "sitemap.xml"),
      );
      const builtSitemap = await readStaticAsset(
        path.join(outDir, "sitemap.xml"),
      );
      const publicRobots = await readStaticAsset(
        path.join(ROOT, "public", "robots.txt"),
      );
      const builtRobots = await readStaticAsset(
        path.join(outDir, "robots.txt"),
      );

      expect([...builtSitemap.bytes]).toEqual([...publicSitemap.bytes]);
      expect([...builtRobots.bytes]).toEqual([...publicRobots.bytes]);
      expectValidSitemap(builtSitemap);
      expectValidRobots(builtRobots);
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  }, 60_000);
});
