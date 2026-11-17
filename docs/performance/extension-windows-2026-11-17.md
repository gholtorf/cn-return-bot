# Extension performance on this PC — 2026-11-17

The separate performance branch starts from first-update commit `756b4dd388173e86e3a273c061f16fbada7f03db`.
An unmodified baseline was measured before editing the performance code. The final comparison
then ran all four combinations in rotating order, with 5 fresh-browser rounds per
combination and two article sizes (40 final samples).
The initial pre-change pilot is retained in the raw data. The final table uses
the same final harness for every variant; its standalone index microbenchmark
runs after the CPU workload to avoid charging its later garbage collection to that workload.

On the long fixture, the combined changes reduced median index construction by 11.3%,
sidebar-update renderer task time by 88.6%, and renderer task time across the defined
initial-load/update/replacement workload by 21.0%.
These percentages describe this local annotation workload, not overall browsing or AI note-writing speed.
The combined short-fixture workload fell by 5.1%.
There is a small-page tradeoff: B alone changed median standalone indexing from
0.8 ms to 1.4 ms.
It is retained for the long-page benefit; the combined short workload still improved.

## Changes

- **A — filter unrelated mutations.** Keep the document observer so article/body
  replacements are noticed, but rebuild anchors only for article edits, article
  movement, or stylesheet changes. Sidebar ticks leave existing ranges intact.
- **B — faster text indexing.** Use an ASCII fast path while preserving the
  existing Unicode case folding and raw offsets; assemble the normalized string
  with one join instead of a chain of per-character string concatenations.

## Medians

Short fixture: 23,377 text characters.

| Variant | Index construction | Four sidebar updates: task time | Two article updates: task time | Initial + updates + replacement: task time | First marker: elapsed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Unmodified first update | 0.8 ms | 39.7 ms | 11.3 ms | 282.7 ms | 389.4 ms |
| A: skip unrelated rebuilds | 1.0 ms | 25.6 ms | 13.8 ms | 272.8 ms | 378.0 ms |
| B: faster text index | 1.4 ms | 36.9 ms | 11.6 ms | 284.4 ms | 392.0 ms |
| A + B | 1.3 ms | 27.0 ms | 13.2 ms | 268.3 ms | 381.1 ms |

Long fixture: 560,577 text characters (a deliberate stress case).

| Variant | Index construction | Four sidebar updates: task time | Two article updates: task time | Initial + updates + replacement: task time | First marker: elapsed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Unmodified first update | 32.7 ms | 241.0 ms | 81.5 ms | 1047.7 ms | 659.0 ms |
| A: skip unrelated rebuilds | 31.4 ms | 26.4 ms | 133.6 ms | 932.3 ms | 673.9 ms |
| B: faster text index | 27.7 ms | 173.6 ms | 69.8 ms | 914.2 ms | 649.9 ms |
| A + B | 29.0 ms | 27.4 ms | 88.1 ms | 828.2 ms | 622.7 ms |

All A and A+B samples caused zero rebuilds for the four unrelated updates.
Baseline and B-only samples caused four. Relevant article edits and replacements
still rebuilt the annotations in every sample.

## Observed ranges

Each range is the minimum–maximum across the 5 rounds, in milliseconds.
The raw data also includes initial-display and replacement measurements.

| Article | Variant | Index | Sidebar task time | Defined-workload task time |
| --- | --- | ---: | ---: | ---: |
| short | Unmodified first update | 0.7–1.4 | 34.7–42.9 | 280.6–296.0 |
| short | A: skip unrelated rebuilds | 0.7–1.2 | 24.6–27.9 | 265.8–276.5 |
| short | B: faster text index | 1.1–1.5 | 34.5–42.8 | 274.1–296.0 |
| short | A + B | 1.2–1.5 | 24.6–27.7 | 265.1–273.2 |
| long | Unmodified first update | 32.3–33.7 | 229.1–260.7 | 1017.9–1120.2 |
| long | A: skip unrelated rebuilds | 15.3–32.9 | 25.9–28.3 | 772.3–982.4 |
| long | B: faster text index | 21.6–28.4 | 115.3–189.5 | 698.2–1028.5 |
| long | A + B | 23.9–29.2 | 26.7–29.3 | 708.1–909.3 |

## Method and limits

- Machine: Intel(R) Core(TM) i7-14650HX; 24 logical CPUs;
  31.7 GiB RAM; win32.
- Chrome for Testing 157.0.8103.78, real unpacked extension, real local Supabase,
  and intercepted Substack-shaped fixtures. No production database or live site is used.
- Each variant/round uses a fresh persistent browser context. Its short and long
  samples use separate pages, with 50 and 1,200 generated paragraphs plus a seeded real note.
- Index construction is the median of 11 calls after three warmups, using the
  same indexing source as that variant's extension. The table reports the median
  of those per-sample medians.
- Task time comes from Chrome DevTools Protocol renderer `TaskDuration` in its
  default `timeTicks` domain, a CPU-work proxy rather than OS process CPU accounting.
  See the [CDP Performance reference](https://chromedevtools.github.io/devtools-protocol/tot/Performance/).
  It measures renderer work during fixed observation periods. The artificial 800 ms waits
  allow the existing 600 ms debounce to fire; those waits are not claimed as saved time.
- The defined-workload task-time column sums initial load, four sidebar updates, two
  article updates and one article replacement. The standalone index microbenchmark
  and later correctness checks are excluded from that sum.
- First-marker elapsed time includes local network, navigation and script-initialization variation.
  Five rounds and the ranges above show variability; this is not a production latency study.
- Every final sample checks the marker, article edits, replacement, movement,
  out-of-article stylesheet insertion and editing, and the connected quote range.
- Local fixture work savings are most useful on long pages with frequent unrelated
  updates. Pages without a distinct article/main container retain broader observation.
  Network, backend query time, sync bandwidth and AI calls are outside these measurements.

## Reproduce

From this working copy on the performance branch, with the local setup already installed:

```powershell
.\scripts\manual-notes\local.ps1 -Action Start
$env:PATH = (Resolve-Path '..\.tools\bun-windows-x64').Path + ';' + $env:PATH
bun scripts/performance/build-matrix.ts --base 756b4dd388173e86e3a273c061f16fbada7f03db
node --experimental-strip-types scripts/performance/extension.ts --variants baseline,filter,index,both --repeats 5 --label comparison-final-verified
node --experimental-strip-types scripts/performance/report.ts --input comparison-final-verified
```

The matrix builder temporarily swaps only the indexing and mount source files,
builds each combination and restores the optimized files in a finally block.
Avoid editing those two files while it runs. Builds, logs and browser data stay
under ignored `.local-test/performance`. The local launcher reuses its saved
Supabase stack when switching branches.

[Raw before/after measurements and source/bundle hashes](extension-windows-2026-11-17.json).
