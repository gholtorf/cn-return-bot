import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const input = process.argv.includes("--input") ? process.argv[process.argv.indexOf("--input") + 1]! : "comparison-final-verified";
const perf = resolve(root, ".local-test/performance");
const read = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const comparison = await read(resolve(perf, `${input}.json`));
comparison.metadata.metricInterpretation = "Fields ending in CpuMs contain CDP TaskDuration in milliseconds using the default timeTicks domain: renderer task time, a CPU-work proxy rather than OS process CPU accounting.";
const before = await read(resolve(perf, "before-changes.json"));
const variants = await Promise.all(["baseline", "filter", "index", "both"].map((v) => read(resolve(perf, "variants", v, "variant.json"))));
const [baselineBuild, filterBuild, indexBuild, combinedBuild] = variants;
if (baselineBuild.anchorSourceHash !== filterBuild.anchorSourceHash || baselineBuild.mountSourceHash !== indexBuild.mountSourceHash || combinedBuild.anchorSourceHash !== indexBuild.anchorSourceHash || combinedBuild.mountSourceHash !== filterBuild.mountSourceHash) throw new Error("Build hashes do not describe the intended independent changes.");
for (const row of comparison.results) {
  if (row.bundleHash !== variants.find((v) => v.variant === row.variant)?.noteScriptHash) throw new Error("Measurements do not match the saved variant bundles.");
}
const fields = ["indexMedianMs", "initialMarkerMs", "initialCpuMs", "unrelatedCpuMs", "contentCpuMs", "replacementCpuMs", "totalCpuMs"] as const;
type Field = typeof fields[number];
type Sample = Record<Field, number> & { variant: string; scenario: string; characters: number; unrelatedRebuilds: number; themeChecked: boolean; movedRebuilds: number };
const samples: Sample[] = comparison.results.map((r: Sample) => ({ ...r, totalCpuMs: r.initialCpuMs + r.unrelatedCpuMs + r.contentCpuMs + r.replacementCpuMs }));
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2; };
const summaries = ["short", "long"].map((scenario) => ({
  scenario,
  variants: ["baseline", "filter", "index", "both"].map((variant) => {
    const rows = samples.filter((r) => r.variant === variant && r.scenario === scenario);
    if (rows.length !== comparison.metadata.repeats || rows.some((r) => !r.themeChecked || r.movedRebuilds < 1)) throw new Error(`Incomplete or failed final comparison: ${variant}/${scenario}`);
    return { variant, count: rows.length, characters: rows[0]!.characters, unrelatedRebuilds: rows.map((r) => r.unrelatedRebuilds), metrics: Object.fromEntries(fields.map((field) => [field, { median: median(rows.map((r) => r[field])), min: Math.min(...rows.map((r) => r[field])), max: Math.max(...rows.map((r) => r[field])) }])) as Record<Field, { median: number; min: number; max: number }> };
  }),
}));
const round = (n: number) => n.toFixed(1);
const names: Record<string, string> = { baseline: "Unmodified first update", filter: "A: skip unrelated rebuilds", index: "B: faster text index", both: "A + B" };
const table = (scenario: typeof summaries[number]) => [
  "| Variant | Index construction | Four sidebar updates: task time | Two article updates: task time | Initial + updates + replacement: task time | First marker: elapsed |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
  ...scenario.variants.map((v) => `| ${names[v.variant]} | ${round(v.metrics.indexMedianMs.median)} ms | ${round(v.metrics.unrelatedCpuMs.median)} ms | ${round(v.metrics.contentCpuMs.median)} ms | ${round(v.metrics.totalCpuMs.median)} ms | ${round(v.metrics.initialMarkerMs.median)} ms |`),
].join("\n");
const ranges = summaries.flatMap((s) => s.variants.map((v) => `| ${s.scenario} | ${names[v.variant]} | ${round(v.metrics.indexMedianMs.min)}–${round(v.metrics.indexMedianMs.max)} | ${round(v.metrics.unrelatedCpuMs.min)}–${round(v.metrics.unrelatedCpuMs.max)} | ${round(v.metrics.totalCpuMs.min)}–${round(v.metrics.totalCpuMs.max)} |`)).join("\n");
const long = summaries.find((s) => s.scenario === "long")!;
const short = summaries.find((s) => s.scenario === "short")!;
const base = long.variants[0]!, both = long.variants[3]!;
const reduction = (field: Field) => (1 - both.metrics[field].median / base.metrics[field].median) * 100;
const date = comparison.metadata.recordedAt.slice(0, 10);
const stem = `extension-windows-${date}`;
const doc = `# Extension performance on this PC — ${date}

The separate performance branch starts from first-update commit \`${variants[0].baseCommit}\`.
An unmodified baseline was measured before editing the performance code. The final comparison
then ran all four combinations in rotating order, with ${comparison.metadata.repeats} fresh-browser rounds per
combination and two article sizes (${samples.length} final samples).
The initial pre-change pilot is retained in the raw data. The final table uses
the same final harness for every variant; its standalone index microbenchmark
runs after the CPU workload to avoid charging its later garbage collection to that workload.

On the long fixture, the combined changes reduced median index construction by ${round(reduction("indexMedianMs"))}%,
sidebar-update renderer task time by ${round(reduction("unrelatedCpuMs"))}%, and renderer task time across the defined
initial-load/update/replacement workload by ${round(reduction("totalCpuMs"))}%.
These percentages describe this local annotation workload, not overall browsing or AI note-writing speed.
The combined short-fixture workload fell by ${round((1 - short.variants[3]!.metrics.totalCpuMs.median / short.variants[0]!.metrics.totalCpuMs.median) * 100)}%.
There is a small-page tradeoff: B alone changed median standalone indexing from
${round(short.variants[0]!.metrics.indexMedianMs.median)} ms to ${round(short.variants[2]!.metrics.indexMedianMs.median)} ms.
It is retained for the long-page benefit; the combined short workload still improved.

## Changes

- **A — filter unrelated mutations.** Keep the document observer so article/body
  replacements are noticed, but rebuild anchors only for article edits, article
  movement, or stylesheet changes. Sidebar ticks leave existing ranges intact.
- **B — faster text indexing.** Use an ASCII fast path while preserving the
  existing Unicode case folding and raw offsets; assemble the normalized string
  with one join instead of a chain of per-character string concatenations.

## Medians

Short fixture: ${summaries[0]!.variants[0]!.characters.toLocaleString("en-US")} text characters.

${table(summaries[0]!)}

Long fixture: ${base.characters.toLocaleString("en-US")} text characters (a deliberate stress case).

${table(long)}

All A and A+B samples caused zero rebuilds for the four unrelated updates.
Baseline and B-only samples caused four. Relevant article edits and replacements
still rebuilt the annotations in every sample.

## Observed ranges

Each range is the minimum–maximum across the ${comparison.metadata.repeats} rounds, in milliseconds.
The raw data also includes initial-display and replacement measurements.

| Article | Variant | Index | Sidebar task time | Defined-workload task time |
| --- | --- | ---: | ---: | ---: |
${ranges}

## Method and limits

- Machine: ${comparison.metadata.cpu}; ${comparison.metadata.logicalCpus} logical CPUs;
  ${round(comparison.metadata.memoryGB)} GiB RAM; ${comparison.metadata.platform}.
- Chrome for Testing 157.0.8103.78, real unpacked extension, real local Supabase,
  and intercepted Substack-shaped fixtures. No production database or live site is used.
- Each variant/round uses a fresh persistent browser context. Its short and long
  samples use separate pages, with 50 and 1,200 generated paragraphs plus a seeded real note.
- Index construction is the median of 11 calls after three warmups, using the
  same indexing source as that variant's extension. The table reports the median
  of those per-sample medians.
- Task time comes from Chrome DevTools Protocol renderer \`TaskDuration\` in its
  default \`timeTicks\` domain, a CPU-work proxy rather than OS process CPU accounting.
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

\`\`\`powershell
.\\scripts\\manual-notes\\local.ps1 -Action Start
$env:PATH = (Resolve-Path '..\\.tools\\bun-windows-x64').Path + ';' + $env:PATH
bun scripts/performance/build-matrix.ts --base ${variants[0].baseCommit}
node --experimental-strip-types scripts/performance/extension.ts --variants baseline,filter,index,both --repeats 5 --label ${input}
node --experimental-strip-types scripts/performance/report.ts --input ${input}
\`\`\`

The matrix builder temporarily swaps only the indexing and mount source files,
builds each combination and restores the optimized files in a finally block.
Avoid editing those two files while it runs. Builds, logs and browser data stay
under ignored \`.local-test/performance\`. The local launcher reuses its saved
Supabase stack when switching branches.

[Raw before/after measurements and source/bundle hashes](${stem}.json).
`;
const destination = resolve(root, "docs/performance");
await mkdir(destination, { recursive: true });
await writeFile(resolve(destination, `${stem}.json`), JSON.stringify({ beforeChanges: before, comparison, variants, summaries }, null, 2));
await writeFile(resolve(destination, `${stem}.md`), doc);
console.log(table(long));
console.log(`Saved docs/performance/${stem}.md and .json`);
