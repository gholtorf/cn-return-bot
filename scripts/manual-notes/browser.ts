import { chromium } from "playwright";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const root = resolve(import.meta.dirname, "../..");
const extension = resolve(root, "src/everything-extension/.output/chrome-mv3-manual-test");
const manifest = JSON.parse(await readFile(resolve(extension, "manifest.json"), "utf8"));
if (manifest.name !== "Common Notes (Local Test)") throw new Error("Build the isolated local-test extension first.");
const context = await chromium.launchPersistentContext(resolve(root, ".local-test/browser-profile"), {
  channel: "chromium",
  headless: false,
  executablePath: existsSync(resolve(root, ".local-test/chrome-stable/chrome-win64/chrome.exe")) ? resolve(root, ".local-test/chrome-stable/chrome-win64/chrome.exe") : undefined,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
// Let YouTube's content script reach this private test backend. This grant is
// scoped to YouTube in this isolated profile, not the user's normal browser.
await context.grantPermissions(["local-network-access"], { origin: "https://www.youtube.com" });
const page = await context.newPage();
await page.goto("http://127.0.0.1:8010/article");
await page.bringToFront();
const launchId = process.argv[process.argv.indexOf("--launch-id") + 1];
await writeFile(resolve(root, ".local-test/browser-ready.json"), JSON.stringify({ pid: process.pid, launchId, url: page.url(), extension: manifest.name }));
console.log("Local test browser is open with Common Notes (Local Test) installed. Close the browser to finish.");
await new Promise<void>((resolve) => context.on("close", () => resolve()));
