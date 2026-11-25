import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, "../..");
const directory = resolve(root, ".local-test/followup");
type ExtensionSample = { name: string; variant: string; round: number; characters: number; expected: number; medianMs: number; times: number[] };
type ServerSample = { scenario: string; variant: string; round: number; elapsedMs: number; upstreamRequests: number };
type Report = { baseline: string; cpu: string; browser: string; node: string; recordedAt: string; extension: ExtensionSample[]; server: ServerSample[]; bundleHashes: unknown };
const comparison = JSON.parse(await readFile(resolve(directory, "comparison.json"), "utf8")) as Report;
const pilot = JSON.parse(await readFile(resolve(directory, "before.json"), "utf8")) as Report;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const time = (value: number) => value < 0.001 ? "<0.001" : value.toFixed(3);
const extensionMedian = (name: string, variant: string) => median(comparison.extension.filter((r) => r.name === name && r.variant === variant).map((r) => r.medianMs));
const rows = [...new Set(comparison.extension.map((r) => r.name))].map((name) => {
  const values = ["baseline", "lazy", "groups", "both"].map((variant) => extensionMedian(name, variant));
  return "| " + name + " | " + values.map(time).join(" | ") + " | " + ((1 - values[3]! / values[0]!) * 100).toFixed(1) + "% |";
});
const serverRows = ["overlap", "distinct"].map((scenario) => {
  const groups = ["baseline", "coalesced"].map((variant) => comparison.server.filter((r) => r.scenario === scenario && r.variant === variant));
  const times = groups.map((group) => median(group.map((r) => r.elapsedMs)));
  return "| " + scenario + " | " + times.map(time).join(" | ") + " | " + groups.map((group) => [...new Set(group.map((r) => r.upstreamRequests))].join(",")).join(" | ") + " | " + ((1 - times[1]! / times[0]!) * 100).toFixed(1) + "% |";
});
const ranges = [...new Set(comparison.extension.map((r) => r.name))].map((name) => "| " + name + " | " + ["baseline", "lazy", "groups", "both"].map((variant) => {
  const values = comparison.extension.filter((r) => r.name === name && r.variant === variant).map((r) => r.medianMs);
  return time(Math.min(...values)) + "–" + time(Math.max(...values));
}).join(" | ") + " |");
const text = [
  "# Additional extension and server performance on this PC — 2026-11-23", "",
  "Baseline: `" + comparison.baseline + "`. This already contains the earlier DOM-mutation filtering and text-index optimizations. These measurements are incremental to that branch; they cannot be added to the earlier 21% renderer-work result.", "",
  "A before-change run was recorded before the runtime sources were edited. The final comparison builds the baseline directly from the pinned Git commit, without changing the checkout, and measures it beside each variant with the same final harness. The original before-change pilot is retained separately in the raw data. The final harness adds combined-workload and quote-range correctness checks.", "",
  "## Changes", "",
  "- **C / lazy:** Construct the article text index only when a nonempty quote needs matching. Empty, fully hidden and image-only note sets still render their UI and image anchors, without walking and normalizing the article text.",
  "- **D / groups:** Compute note status once, append notes to their group without copying growing arrays, and associate note-not-needed entries in one pass instead of scanning every entry for every claim. First-seen claim order, original-before-improvement ordering, first-visible claim identity, status/display priorities and entry order are preserved.",
  "- **Server:** Share an overlapping fetch of the exact same URL within each fetch endpoint. Page, plain API, browser API and image endpoints own separate registries. Finished and failed results are immediately released. The registry holds at most 128 distinct pending URLs per endpoint; new URLs pass through at capacity. Minisite requests include page data and are deliberately excluded from this URL-only optimization.", "",
  "## Extension results", "",
  "Milliseconds per call; median of five fresh-browser-context round medians. C and D are tested alone and together. These are browser hot-path microbenchmarks, not navigation latency or whole-extension CPU measurements.", "",
  "| Workload | Baseline | C only | D only | C + D | C + D reduction |",
  "| --- | ---: | ---: | ---: | ---: | ---: |", ...rows, "",
  "Short/long articles have " + comparison.extension.find((r) => r.name === "text-short")!.characters + "/" + comparison.extension.find((r) => r.name === "text-long")!.characters + " text characters. Empty cases contain zero visible claims; image/text cases contain one. Group-small has 10 claims, 30 notes and 10 note-not-needed entries; group-large has 1,000 claims, 3,000 notes and 1,000 entries (a stress case). Combined-image-long groups 10 claims/30 notes before anchoring their images. Combined-text-large-long groups 1,000 claims/3,000 notes before anchoring their quotes.", "",
  "The normal text-only anchoring controls are approximately unchanged: they still need a text index. Tiny sub-millisecond differences and percentages should not be read as user-visible speedups. The C-only grouping control was slower despite using the unchanged grouping implementation; its cause was not established. The table and ranges retain that result. The final C+D variant improves the measured combined workloads. Do not add the separate percentage improvements or assume they predict a production page.", "",
  "### Ranges across five round medians (ms)", "",
  "| Workload | Baseline | C only | D only | C + D |", "| --- | ---: | ---: | ---: | ---: |", ...ranges, "",
  "## Server results", "",
  "Seven rounds, alternating variant order. Each burst makes 40 real loopback HTTP requests through a gateway to a controlled upstream that permits four active requests and waits 25 ms per request. The optimized gateway uses the same coalesceFetch helper as the production fetch endpoints. The fixture does not start the Linux Unix-socket service or run its real web-fetch ladder.", "",
  "| Burst | Baseline elapsed ms | Shared-fetch elapsed ms | Baseline upstream requests | Shared-fetch upstream requests | Elapsed reduction |", "| --- | ---: | ---: | ---: | ---: | ---: |", ...serverRows, "",
  "Overlap uses five exact URLs, eight callers each: downstream work falls from 40 requests to 5 (87.5% fewer). Distinct uses 40 URLs: downstream work remains 40 requests and elapsed time is approximately unchanged. The benefit depends on overlapping requests and upstream contention; isolated or sequential requests do not become faster. These local fixture results establish the mechanism, not production server latency, AI-generation speed, or a production cache-hit rate. There is no completed-result cache and no database migration.", "",
  "## Method and validation", "",
  "- CPU: " + comparison.cpu + "; Node " + comparison.node + "; Chrome " + comparison.browser + ".",
  "- Browser code is bundled from the actual runtime modules. Baseline/C/D/C+D source selection happens in the build plugin without temporarily swapping source files. Bundle hashes and all raw timings are retained. Variant order rotates and reverses across rounds. Each case warms up three calls, then records 11 batches lasting at least 30 ms each (or at most 10,000 calls); round medians reduce timer-resolution noise.",
  "- Browser contexts use synthetic articles and notes; network requests are blocked. Every run checks the number of anchored claims; text and image Range contents are checked outside the timed loop. Live services, production data, and paid AI calls are not used.",
  "- Regression tests cover grouping order and priorities, input preservation, entry ownership, identical/distinct URLs, endpoint separation, fresh requests after completion, shared failures and recovery, synchronous exceptions, and registry saturation. The existing manual-note delivery tests remain in the suite.",
  "- Full suite (`bun test --timeout 15000`): 1,043 passed, 33 skipped, zero failed. The cold first run exceeded the default five-second timeout in an unrelated proxy source-scan test; the repeat completed in 9.49 seconds overall. `bun run check` passed all four TypeScript projects, ESLint and knip (one existing configuration hint). Chrome and Firefox manual-test builds passed. Optional database-dependent tests remain skipped unless their fixture databases are configured.", "",
  "## Reproduce", "",
  "From the repository root after installing locked dependencies and a Playwright-compatible Chrome:", "",
  "```powershell",
  "$env:CN_BENCH_CHROME = 'C:\\path\\to\\chrome.exe'",
  "bun scripts/performance/build-followup.ts",
  "node --experimental-strip-types scripts/performance/followup.ts",
  "bun scripts/performance/build-followup.ts --after",
  "node --experimental-strip-types scripts/performance/followup.ts --after",
  "node --experimental-strip-types scripts/performance/report-followup.ts",
  "bun test",
  "bun run check",
  "```", "",
  "The first two commands can be run before editing runtime code to retain a pilot. The final four-way build always obtains its baseline from Git. If CN_BENCH_CHROME is omitted, Playwright uses its installed Chromium. Measurements, generated bundles and logs remain under ignored `.local-test/followup`.", "",
  "[Raw pilot and final measurements](extension-server-windows-2026-11-23.json).", "",
].join("\n");
const serverSourceSHA256 = createHash("sha256").update(await readFile(resolve(root, "src/service/fetch/coalesceFetch.ts"))).digest("hex");
await writeFile(resolve(root, "docs/performance/extension-server-windows-2026-11-23.json"), JSON.stringify({ pilot, comparison, serverSourceSHA256 }, null, 2) + "\n");
await writeFile(resolve(root, "docs/performance/extension-server-windows-2026-11-23.md"), text);
console.log(rows.join("\n"));
console.log(serverRows.join("\n"));
