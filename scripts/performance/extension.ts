import { chromium, type Page, type CDPSession } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { cpus, totalmem, platform } from "node:os";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { Database } from "../../src/everything-core/database.types.ts";

const root = resolve(import.meta.dirname, "../..");
const arg = (name: string, fallback: string) => process.argv[process.argv.indexOf(name) + 1] ?? fallback;
const variants = process.argv.includes("--variants") ? arg("--variants", "baseline").split(",") : ["baseline"];
const repeats = process.argv.includes("--repeats") ? Number(arg("--repeats", "5")) : 5;
if (!Number.isInteger(repeats) || repeats < 1 || variants.some((v) => !["baseline", "filter", "index", "both"].includes(v))) throw new Error("Use baseline,filter,index,both and a positive repeat count.");
const label = process.argv.includes("--label") ? arg("--label", "measurements") : "measurements";
const perf = resolve(root, ".local-test/performance");
const status = JSON.parse((await readFile(resolve(root, ".local-test/status.json"), "utf8")).replace(/^\uFEFF/, ""));
if (status.env.API_URL !== "http://127.0.0.1:54321") throw new Error("Only the isolated local backend may be benchmarked.");
const admin = createClient<Database>(status.env.API_URL, status.env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const quote = "This is the exact passage that the performance fixture's note explains.";
const sentence = "A representative article paragraph contains ordinary mixed-case words, numbers 12345, punctuation, and a few Unicode examples such as café and Kelvin. ";
const cases = [{ name: "short", paragraphs: 50 }, { name: "long", paragraphs: 1200 }];
const urls = cases.map((c) => `https://performance-fixture.substack.com/p/${c.name}`);
const { data: project, error: projectError } = await admin.from("everything_projects").upsert({ slug: "local-performance", name: "Local performance fixtures" }, { onConflict: "slug" }).select("id").single();
if (projectError) throw projectError;
for (const [index, scenario] of cases.entries()) {
  const { data: item, error } = await admin.from("everything_items").upsert({ project_id: project!.id, source: "web", url: urls[index]!, title: `Performance ${scenario.name}`, status: "done", full_text: quote + sentence.repeat(scenario.paragraphs * 3) }, { onConflict: "url" }).select("id").single();
  if (error) throw error;
  const { data: existing } = await admin.from("everything_claims").select("id").eq("item_id", item!.id).limit(1);
  if (!existing?.length) {
    const { data: claim, error: claimError } = await admin.from("everything_claims").insert({ item_id: item!.id, claim: quote, context_quote: quote, judgement: "uncertain", status: "note" }).select("id").single();
    if (claimError) throw claimError;
    const { error: noteError } = await admin.from("everything_notes").insert({ claim_id: claim!.id, note: "This locally seeded note verifies that annotation survives all benchmark mutations.", status: "published" });
    if (noteError) throw noteError;
  }
}
await mkdir(perf, { recursive: true });
type Result = { variant: string; scenario: string; repeat: number; characters: number; indexMedianMs: number; initialMarkerMs: number; initialCpuMs: number; unrelatedCpuMs: number; unrelatedRebuilds: number; contentCpuMs: number; contentRebuilds: number; replacementCpuMs: number; replacementRebuilds: number; markers: number; themeChecked: boolean; movedRebuilds: number; bundleHash: string };
const results: Result[] = [];
const metadata = { recordedAt: new Date().toISOString(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryGB: totalmem() / 2 ** 30, platform: platform(), variants, repeats, warmups: 3, indexSamples: 11, unrelatedUpdates: 4, articleUpdates: 2, settleMs: 800, note: "Local real extension and Supabase; intercepted Substack-shaped HTML; loopback permission granted; no live site or production database. CPU is renderer TaskDuration, not wall-clock wait time." };
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const metrics = async (cdp: CDPSession) => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m: { name: string; value: number }) => [m.name, m.value])) as Record<string, number>;
const cpuMs = (before: Record<string, number>, after: Record<string, number>) => (after.TaskDuration! - before.TaskDuration!) * 1000;
const marker = (page: Page) => page.getByRole("button", { name: /^Common Note on this passage,/ });
function html(paragraphs: number) {
  return `<!doctype html><html><head><meta name="color-scheme" content="light"><title>Extension performance fixture</title><style>body{font:16px/1.5 system-ui;margin:24px}article{max-width:760px}aside{position:fixed;right:10px;top:10px}</style></head><body><aside id="sidebar">Unrelated sidebar</aside><article><div class="available-content"><p>${quote}</p><p id="article-ticker">Article state</p>${Array.from({ length: paragraphs }, (_, i) => `<p>${i}: ${sentence.repeat(3)}</p>`).join("")}</div></article></body></html>`;
}

// Rotate the variant order each round to avoid always favoring a warm machine.
for (let repeat = 0; repeat < repeats; repeat++) {
  const order = variants.map((_, i) => variants[(i + repeat) % variants.length]!);
  if (repeat % 2) order.reverse();
  for (const variant of order) {
    const extension = resolve(perf, "variants", variant);
    const script = await readFile(resolve(extension, "content-scripts/notes.js"));
    const indexModule = `data:text/javascript;base64,${(await readFile(resolve(extension, "anchor.mjs"))).toString("base64")}`;
    const context = await chromium.launchPersistentContext("", { headless: true, executablePath: resolve(root, ".local-test/chrome-stable/chrome-win64/chrome.exe"), args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    try {
      await context.grantPermissions(["local-network-access"], { origin: "https://performance-fixture.substack.com" });
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      // Seed only the local coverage hint, leaving the real note reads untouched.
      await worker.evaluate(async (urls) => {
        const api = (globalThis as unknown as { chrome: { storage: { local: { set(v: unknown): Promise<void> } } } }).chrome;
        await api.storage.local.set({ "cn:coveredPageUrls": urls });
      }, urls);
      for (const scenario of cases) {
        const url = `https://performance-fixture.substack.com/p/${scenario.name}`;
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        let rebuilds = 0;
        page.on("console", (message) => { if (message.text().startsWith("[common-notes] anchored ")) rebuilds++; });
        await page.route(url, (route) => route.fulfill({ contentType: "text/html", body: html(scenario.paragraphs) }));
        const cdp = await context.newCDPSession(page);
        await cdp.send("Performance.enable");
        const initialBefore = await metrics(cdp);
        const started = performance.now();
        await page.goto(url);
        await marker(page).waitFor({ timeout: 30_000 });
        const initialMarkerMs = performance.now() - started;
        await wait(1600);
        const initialCpuMs = cpuMs(initialBefore, await metrics(cdp));
        const unrelatedBefore = await metrics(cdp), unrelatedCount = rebuilds;
        for (let i = 0; i < 4; i++) { await page.locator("#sidebar").evaluate((el, i) => { el.textContent = `Sidebar update ${i}`; }, i); await wait(800); }
        const unrelatedCpuMs = cpuMs(unrelatedBefore, await metrics(cdp));
        const unrelatedRebuilds = rebuilds - unrelatedCount;
        const contentBefore = await metrics(cdp), contentCount = rebuilds;
        for (let i = 0; i < 2; i++) { await page.locator("#article-ticker").evaluate((el, i) => { el.textContent = `Article update ${i}`; }, i); await wait(800); }
        const contentCpuMs = cpuMs(contentBefore, await metrics(cdp));
        const contentRebuilds = rebuilds - contentCount;
        const replacementBefore = await metrics(cdp), replacementCount = rebuilds;
        await page.locator("article").evaluate((el) => { const replacement = el.cloneNode(true) as Element; replacement.querySelectorAll("common-notes-inline").forEach((node) => node.remove()); el.replaceWith(replacement); });
        await wait(1600);
        const replacementCpuMs = cpuMs(replacementBefore, await metrics(cdp));
        const replacementRebuilds = rebuilds - replacementCount;
        const markers = await marker(page).count();
        if (markers !== 1 || contentRebuilds < 2 || replacementRebuilds < 1 || errors.length) throw new Error(`Annotation regression in ${variant}/${scenario.name}: ${JSON.stringify({ markers, contentRebuilds, replacementRebuilds, errors })}`);
        // Run the allocation-heavy microbenchmark after the CPU workload so
        // its garbage collection cannot contaminate those measurements.
        const index = await page.evaluate(async (moduleUrl) => {
          const { indexContainer } = await import(moduleUrl);
          const container = document.querySelector("article .available-content")!;
          for (let i = 0; i < 3; i++) indexContainer(container);
          const samples: number[] = [];
          for (let i = 0; i < 11; i++) {
            const start = performance.now(); indexContainer(container); samples.push(performance.now() - start);
          }
          samples.sort((a, b) => a - b);
          return { characters: container.textContent!.length, median: samples[5]! };
        }, indexModule);
        // Correctness checks run after the measured CPU periods: styles inserted
        // outside the article must still update the theme, and moving the same
        // article must not leave a highlight attached to a detached text node.
        await page.locator("#sidebar").evaluate((sidebar) => { const style = document.createElement("style"); style.textContent = "html{color-scheme:dark}body{background:#111;color:#eee}"; sidebar.append(style); });
        await wait(1600);
        const darkThemeChecked = await page.locator("common-notes-ui").evaluate((host) => !!host.shadowRoot?.querySelector(".cn-theme-root.dark"));
        await page.locator("#sidebar style").evaluate((style) => { style.textContent = "html{color-scheme:light}body{background:white;color:black}"; });
        await wait(1600);
        const themeChecked = darkThemeChecked && await page.locator("common-notes-ui").evaluate((host) => !!host.shadowRoot?.querySelector(".cn-theme-root:not(.dark)"));
        const movedCount = rebuilds;
        await page.locator("article").evaluate((article) => { const wrapper = document.createElement("section"); article.parentElement!.append(wrapper); wrapper.append(article); });
        await wait(800);
        const movedRebuilds = rebuilds - movedCount;
        const rangesValid = await page.evaluate((quote) => {
          const highlight = CSS.highlights.get("common-notes-passage-tint-1");
          const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          let count = 0, valid = true;
          highlight?.forEach((range) => { count++; valid &&= range.startContainer.isConnected && range.endContainer.isConnected && normalize(range.toString()) === normalize(quote); });
          return count === 1 && valid;
        }, quote);
        if (!themeChecked || movedRebuilds < 1 || !rangesValid || await marker(page).count() !== 1) throw new Error(`Theme/move/range regression in ${variant}/${scenario.name}: ${JSON.stringify({ themeChecked, movedRebuilds, rangesValid })}`);
        results.push({ variant, scenario: scenario.name, repeat, characters: index.characters, indexMedianMs: index.median, initialMarkerMs, initialCpuMs, unrelatedCpuMs, unrelatedRebuilds, contentCpuMs, contentRebuilds, replacementCpuMs, replacementRebuilds, markers, themeChecked, movedRebuilds, bundleHash: createHash("sha256").update(script).digest("hex") });
        await writeFile(resolve(perf, `${label}.json`), JSON.stringify({ metadata, results }, null, 2));
        console.log(`${variant}/${scenario.name} #${repeat + 1}: index ${index.median.toFixed(2)} ms; sidebar CPU ${unrelatedCpuMs.toFixed(1)} ms (${unrelatedRebuilds} rebuilds); article CPU ${contentCpuMs.toFixed(1)} ms`);
        await page.close();
      }
    } finally { await context.close(); }
  }
}
console.log(`Saved ${results.length} measurements to .local-test/performance/${label}.json`);
