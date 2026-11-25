# Additional extension and server performance on this PC — 2026-11-23

Baseline: `21edd7e66c760e9e8da49d0e6fa86ae865de4bf2`. This already contains the earlier DOM-mutation filtering and text-index optimizations. These measurements are incremental to that branch; they cannot be added to the earlier 21% renderer-work result.

A before-change run was recorded before the runtime sources were edited. The final comparison builds the baseline directly from the pinned Git commit, without changing the checkout, and measures it beside each variant with the same final harness. The original before-change pilot is retained separately in the raw data. The final harness adds combined-workload and quote-range correctness checks.

## Changes

- **C / lazy:** Construct the article text index only when a nonempty quote needs matching. Empty, fully hidden and image-only note sets still render their UI and image anchors, without walking and normalizing the article text.
- **D / groups:** Compute note status once, append notes to their group without copying growing arrays, and associate note-not-needed entries in one pass instead of scanning every entry for every claim. First-seen claim order, original-before-improvement ordering, first-visible claim identity, status/display priorities and entry order are preserved.
- **Server:** Share an overlapping fetch of the exact same URL within each fetch endpoint. Page, plain API, browser API and image endpoints own separate registries. Finished and failed results are immediately released. The registry holds at most 128 distinct pending URLs per endpoint; new URLs pass through at capacity. Minisite requests include page data and are deliberately excluded from this URL-only optimization.

## Extension results

Milliseconds per call; median of five fresh-browser-context round medians. C and D are tested alone and together. These are browser hot-path microbenchmarks, not navigation latency or whole-extension CPU measurements.

| Workload | Baseline | C only | D only | C + D | C + D reduction |
| --- | ---: | ---: | ---: | ---: | ---: |
| empty-short | 0.358 | <0.001 | 0.347 | <0.001 | 99.9% |
| empty-long | 8.900 | <0.001 | 8.975 | <0.001 | 100.0% |
| image-long | 9.000 | 0.010 | 9.025 | 0.011 | 99.9% |
| text-short | 0.347 | 0.354 | 0.355 | 0.354 | -2.0% |
| text-long | 9.075 | 9.050 | 9.000 | 9.050 | 0.3% |
| group-small | 0.028 | 0.028 | 0.012 | 0.013 | 53.8% |
| group-large | 8.400 | 15.700 | 1.173 | 1.177 | 86.0% |
| combined-image-long | 9.175 | 0.122 | 9.100 | 0.116 | 98.7% |
| combined-text-large-long | 26.150 | 20.950 | 11.833 | 12.000 | 54.1% |

Short/long articles have 15254/366154 text characters. Empty cases contain zero visible claims; image/text cases contain one. Group-small has 10 claims, 30 notes and 10 note-not-needed entries; group-large has 1,000 claims, 3,000 notes and 1,000 entries (a stress case). Combined-image-long groups 10 claims/30 notes before anchoring their images. Combined-text-large-long groups 1,000 claims/3,000 notes before anchoring their quotes.

The normal text-only anchoring controls are approximately unchanged: they still need a text index. Tiny sub-millisecond differences and percentages should not be read as user-visible speedups. The C-only grouping control was slower despite using the unchanged grouping implementation; its cause was not established. The table and ranges retain that result. The final C+D variant improves the measured combined workloads. Do not add the separate percentage improvements or assume they predict a production page.

### Ranges across five round medians (ms)

| Workload | Baseline | C only | D only | C + D |
| --- | ---: | ---: | ---: | ---: |
| empty-short | 0.339–0.437 | <0.001–<0.001 | 0.338–0.367 | <0.001–<0.001 |
| empty-long | 8.800–10.050 | <0.001–<0.001 | 8.800–9.600 | <0.001–<0.001 |
| image-long | 8.750–13.133 | 0.010–0.011 | 8.775–20.450 | 0.010–0.015 |
| text-short | 0.339–0.484 | 0.347–0.375 | 0.341–0.760 | 0.347–0.484 |
| text-long | 8.650–9.625 | 9.000–9.525 | 8.775–15.950 | 8.875–9.300 |
| group-small | 0.027–0.033 | 0.027–0.028 | 0.012–0.023 | 0.012–0.015 |
| group-large | 7.900–8.925 | 9.675–15.950 | 1.162–1.988 | 1.156–1.405 |
| combined-image-long | 9.100–11.467 | 0.121–0.139 | 8.800–14.100 | 0.106–0.170 |
| combined-text-large-long | 21.200–34.250 | 20.150–21.800 | 11.667–20.200 | 11.600–14.100 |

## Server results

Seven rounds, alternating variant order. Each burst makes 40 real loopback HTTP requests through a gateway to a controlled upstream that permits four active requests and waits 25 ms per request. The optimized gateway uses the same coalesceFetch helper as the production fetch endpoints. The fixture does not start the Linux Unix-socket service or run its real web-fetch ladder.

| Burst | Baseline elapsed ms | Shared-fetch elapsed ms | Baseline upstream requests | Shared-fetch upstream requests | Elapsed reduction |
| --- | ---: | ---: | ---: | ---: | ---: |
| overlap | 377.075 | 105.941 | 40 | 5 | 71.9% |
| distinct | 375.488 | 376.473 | 40 | 40 | -0.3% |

Overlap uses five exact URLs, eight callers each: downstream work falls from 40 requests to 5 (87.5% fewer). Distinct uses 40 URLs: downstream work remains 40 requests and elapsed time is approximately unchanged. The benefit depends on overlapping requests and upstream contention; isolated or sequential requests do not become faster. These local fixture results establish the mechanism, not production server latency, AI-generation speed, or a production cache-hit rate. There is no completed-result cache and no database migration.

## Method and validation

- CPU: Intel(R) Core(TM) i7-14650HX; Node v24.21.0; Chrome 157.0.8103.78.
- Browser code is bundled from the actual runtime modules. Baseline/C/D/C+D source selection happens in the build plugin without temporarily swapping source files. Bundle hashes and all raw timings are retained. Variant order rotates and reverses across rounds. Each case warms up three calls, then records 11 batches lasting at least 30 ms each (or at most 10,000 calls); round medians reduce timer-resolution noise.
- Browser contexts use synthetic articles and notes; network requests are blocked. Every run checks the number of anchored claims; text and image Range contents are checked outside the timed loop. Live services, production data, and paid AI calls are not used.
- Regression tests cover grouping order and priorities, input preservation, entry ownership, identical/distinct URLs, endpoint separation, fresh requests after completion, shared failures and recovery, synchronous exceptions, and registry saturation. The existing manual-note delivery tests remain in the suite.
- Full suite (`bun test --timeout 15000`): 1,043 passed, 33 skipped, zero failed. The cold first run exceeded the default five-second timeout in an unrelated proxy source-scan test; the repeat completed in 9.49 seconds overall. `bun run check` passed all four TypeScript projects, ESLint and knip (one existing configuration hint). Chrome and Firefox manual-test builds passed. Optional database-dependent tests remain skipped unless their fixture databases are configured.

## Reproduce

From the repository root after installing locked dependencies and a Playwright-compatible Chrome:

```powershell
$env:CN_BENCH_CHROME = 'C:\path\to\chrome.exe'
bun scripts/performance/build-followup.ts
node --experimental-strip-types scripts/performance/followup.ts
bun scripts/performance/build-followup.ts --after
node --experimental-strip-types scripts/performance/followup.ts --after
node --experimental-strip-types scripts/performance/report-followup.ts
bun test
bun run check
```

The first two commands can be run before editing runtime code to retain a pilot. The final four-way build always obtains its baseline from Git. If CN_BENCH_CHROME is omitted, Playwright uses its installed Chromium. Measurements, generated bundles and logs remain under ignored `.local-test/followup`.

[Raw pilot and final measurements](extension-server-windows-2026-11-23.json).
