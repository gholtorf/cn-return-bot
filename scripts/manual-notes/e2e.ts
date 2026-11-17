import { chromium, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Database } from "../../src/everything-core/database.types.ts";

const root = resolve(import.meta.dirname, "../..");
const status = JSON.parse(await readFile(resolve(root, ".local-test/status.json"), "utf8"));
if (status.env.API_URL !== "http://127.0.0.1:54321") throw new Error("E2E tests may only write to the isolated local backend.");
const admin = createClient<Database>(status.env.API_URL, status.env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const extension = resolve(root, "src/everything-extension/.output/chrome-mv3-manual-test");
const run = Date.now().toString();
const output = resolve(root, ".local-test/results", run);
await mkdir(output, { recursive: true });
const context = await chromium.launchPersistentContext(resolve(root, ".local-test/e2e-profiles", run), {
  channel: "chromium", headless: false,
  executablePath: existsSync(resolve(root, ".local-test/chrome-stable/chrome-win64/chrome.exe")) ? resolve(root, ".local-test/chrome-stable/chrome-win64/chrome.exe") : undefined,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const results: { name: string; noteId?: string; passed: boolean }[] = [];
const errors: string[] = [];
context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
const id = new URL(worker.url()).host;
// The popup is loaded as an extension page for automation. Keep the article
// active while reloading the popup so its activeTab lookup names that article.
async function popupFor(page: Page) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await page.bringToFront();
  await popup.reload();
  await popup.getByRole("button", { name: "Write your own note", exact: true }).waitFor();
  return popup;
}
async function check(promise: PromiseLike<{ error: unknown }>) {
  const result = await promise;
  if (result.error) throw result.error;
}
try {
  const { data: project, error } = await admin.from("everything_projects").select("id").eq("slug", "web").single();
  if (error) throw error;
  for (const state of ["unchecked", "queued", "processing"] as const) {
    const url = `http://127.0.0.1:8010/e2e-${run}-${state}`;
    if (state !== "unchecked") await check(admin.from("everything_items").insert({ project_id: project!.id, source: "web", url, title: `Local ${state} test`, status: state }));
    const article = await context.newPage();
    await article.goto(url);
    await article.locator("#passage").evaluate((el) => {
      const range = document.createRange(); range.selectNodeContents(el);
      window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    });
    const popup = await popupFor(article);
    // DOM click preserves the active article tab, just like a toolbar popup.
    await popup.getByRole("button", { name: "Write your own note", exact: true }).evaluate((button) => (button as HTMLButtonElement).click());
    const composer = article.getByPlaceholder("Write your correction");
    await composer.waitFor({ timeout: 30_000 });
    const text = `Manual ${state} test ${run}: The Moon is made of rock, not green cheese.`;
    await composer.fill(text);
    await article.getByRole("button", { name: "Post note", exact: true }).click();
    await composer.waitFor({ state: "hidden", timeout: 30_000 });
    await article.getByRole("button", { name: /^Common Note on this passage,/ }).click();
    await article.getByText(text, { exact: true }).waitFor({ state: "attached", timeout: 30_000 });
    const { data: note, error: noteError } = await admin.from("everything_notes").select("id, status, helpful_count, claim:everything_claims!inner(item_id)").eq("note", text).single();
    if (noteError || !note || note.status !== "draft" || note.helpful_count !== 1) throw new Error(`Saved note or automatic self vote missing: ${JSON.stringify(noteError ?? note)}`);
    if (state !== "unchecked") {
      const { data: item } = await admin.from("everything_items").select("status").eq("url", url).single();
      if (item?.status !== state) throw new Error("Manual posting unexpectedly changed the bot's work state.");
    }
    await article.reload();
    await article.getByRole("button", { name: /^Common Note on this passage,/ }).click();
    await article.getByText(text, { exact: true }).waitFor({ state: "attached", timeout: 30_000 });
    await article.screenshot({ path: resolve(output, `${state}.png`), fullPage: true });
    results.push({ name: `Post and reload while ${state}`, noteId: note.id, passed: true });
    console.log(`PASS: manual note saved and visible after reload (${state}); bot state preserved.`);
    await popup.close().catch(() => {});
    await article.close();
  }
  // An intercepted local player fixture exercises the YouTube content script
  // and real database permissions without depending on YouTube or captions.
  const videoId = run.slice(-11);
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  await context.grantPermissions(["local-network-access"], { origin: "https://www.youtube.com" });
  const video = await context.newPage();
  // Use real media metadata: JavaScript property overrides in the page's world
  // do not reach the extension's isolated world.
  const sound = Buffer.alloc(44 + 60 * 8000, 128);
  sound.write("RIFF", 0); sound.writeUInt32LE(sound.length - 8, 4); sound.write("WAVEfmt ", 8);
  sound.writeUInt32LE(16, 16); sound.writeUInt16LE(1, 20); sound.writeUInt16LE(1, 22);
  sound.writeUInt32LE(8000, 24); sound.writeUInt32LE(8000, 28); sound.writeUInt16LE(1, 32); sound.writeUInt16LE(8, 34);
  sound.write("data", 36); sound.writeUInt32LE(sound.length - 44, 40);
  await video.route(videoUrl, (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><title>Local video-note fixture</title><body><ytd-watch-metadata><h1>Local video-note fixture</h1></ytd-watch-metadata><div id="movie_player" style="position:relative;width:640px;height:360px;background:#ddd"><video class="html5-main-video" src="data:audio/wav;base64,${sound.toString("base64")}" preload="auto"></video><div class="ytp-progress-bar" style="position:absolute;bottom:0;width:100%;height:6px"></div></div></body></html>` }));
  await video.goto(videoUrl);
  await video.waitForFunction(() => { const v = document.querySelector("video"); return v && Number.isFinite(v.duration); });
  await video.locator("video").evaluate((v) => { (v as HTMLVideoElement).currentTime = 42; });
  const videoPopup = await popupFor(video);
  await videoPopup.getByRole("button", { name: "Write your own note", exact: true }).evaluate((button) => (button as HTMLButtonElement).click());
  const videoComposer = video.getByPlaceholder("Write your correction");
  await videoComposer.waitFor({ timeout: 30_000 });
  const videoText = `Manual video test ${run}: This note was written without a transcript or an automated check.`;
  await videoComposer.fill(videoText);
  await video.getByRole("button", { name: "Post note", exact: true }).click();
  await videoComposer.waitFor({ state: "hidden", timeout: 30_000 });
  await video.getByRole("button", { name: /^Open this Common Note,/ }).click();
  await video.getByText(videoText, { exact: true }).waitFor();
  const { data: videoNote, error: videoError } = await admin.from("everything_notes").select("id, claim:everything_claims!inner(start_seconds, end_seconds, context_quote)").eq("note", videoText).single();
  if (videoError || videoNote?.claim.start_seconds !== 32 || videoNote.claim.end_seconds !== 42 || videoNote.claim.context_quote !== null) throw new Error("Video note did not save the chosen time range without captions.");
  await video.reload();
  await video.getByRole("button", { name: /^Open this Common Note,/ }).click();
  await video.getByText(videoText, { exact: true }).waitFor();
  await video.screenshot({ path: resolve(output, "video-fixture.png"), fullPage: true });
  results.push({ name: "YouTube player fixture: post a timed note without captions and reload", noteId: videoNote.id, passed: true });
  console.log("PASS: video fixture note saved at 00:32–00:42 without captions, and visible after reload.");
  await video.close();
  await videoPopup.close().catch(() => {});

  const article = await context.newPage();
  await article.goto(`http://127.0.0.1:8010/no-selection-${run}`);
  const popup = await popupFor(article);
  await popup.getByRole("button", { name: "Write your own note", exact: true }).evaluate((button) => (button as HTMLButtonElement).click());
  await popup.getByRole("alert").filter({ hasText: "Select the passage" }).waitFor();
  results.push({ name: "Missing selection explains how to write", passed: true });
  console.log("PASS: missing selection gets instructions.");
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
} catch (error) {
  results.push({ name: String(error), passed: false });
  for (const [index, page] of context.pages().entries()) await page.screenshot({ path: resolve(output, `failure-${index}.png`) }).catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify({ run, results, errors }, null, 2));
  await context.close();
}
