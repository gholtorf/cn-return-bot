import { chromium } from "playwright";
import { createServer, type Server } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { cpus } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
const root = resolve(import.meta.dirname, "../..");
const output = resolve(root, ".local-test/followup");
await mkdir(output, { recursive: true });
const after = process.argv.includes("--after");
const variants = after ? ["baseline", "lazy", "groups", "both"] : ["baseline"];
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CN_BENCH_CHROME });
const browserVersion = browser.version();
const extension: unknown[] = [];
try {
  for (let round = 0; round < 5; round++) {
    const order = variants.map((_, i) => variants[(i + round) % variants.length]!);
    if (round % 2) order.reverse();
    for (const variant of order) {
      const context = await browser.newContext();
      // All benchmark data are synthetic. No backend or external network is used.
      await context.route("**/*", (route) => route.abort());
      const page = await context.newPage();
      await page.goto("about:blank");
      const source = await readFile(resolve(output, variant + ".mjs"), "utf8");
      await page.evaluate(async (source) => {
        console.info = () => {};
        const module = await import(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
        (window as unknown as { benchmark: typeof module }).benchmark = module;
      }, source);
      for (const name of ["empty-short", "empty-long", "image-long", "text-short", "text-long", "group-small", "group-large", "combined-image-long", "combined-text-large-long"]) {
        const result = await page.evaluate((name) => (window as unknown as { benchmark: { measure(name: string): { times: number[] } } }).benchmark.measure(name), name);
        extension.push({ variant, round, ...result, medianMs: median(result.times) });
      }
      await context.close();
    }
  }
} finally { await browser.close(); }

const listen = async (server: Server) => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server port");
  return "http://127.0.0.1:" + address.port;
};
const close = async (server: Server) => { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); };
const coalesce = after ? (await import("../../src/service/fetch/coalesceFetch.ts")).coalesceFetch : <T>(fetcher: (url: string) => Promise<T>) => fetcher;
const serverResults: unknown[] = [];
for (let round = 0; round < 7; round++) {
  for (const variant of (after ? (round % 2 ? ["coalesced", "baseline"] : ["baseline", "coalesced"]) : ["baseline"])) {
    for (const scenario of ["overlap", "distinct"]) {
      let calls = 0;
      let active = 0;
      const waiting: (() => void)[] = [];
      const upstream = createServer(async (request, response) => {
        calls++;
        if (active >= 4) await new Promise<void>((done) => waiting.push(done));
        else active++;
        await delay(25);
        response.end(JSON.stringify({ url: request.url }));
        const next = waiting.shift();
        if (next) next(); else active--;
      });
      const upstreamUrl = await listen(upstream);
      const fetcher = async (url: string) => {
        const response = await fetch(upstreamUrl + "/?url=" + encodeURIComponent(url));
        if (!response.ok) throw new Error("Upstream request failed");
        return response.json();
      };
      const handler = variant === "coalesced" ? coalesce(fetcher) : fetcher;
      const gateway = createServer(async (request, response) => {
        const url = new URL(request.url!, "http://localhost").searchParams.get("url")!;
        response.end(JSON.stringify(await handler(url)));
      });
      const gatewayUrl = await listen(gateway);
      try {
        const started = performance.now();
        await Promise.all(Array.from({ length: 40 }, async (_, i) => {
          const key = "page-" + (scenario === "overlap" ? i % 5 : i);
          const response = await fetch(gatewayUrl + "/?url=" + key);
          const body = await response.json() as { url: string };
          if (body.url !== "/?url=" + key) throw new Error("Wrong page returned");
        }));
        const elapsedMs = performance.now() - started;
        const expectedCalls = variant === "coalesced" && scenario === "overlap" ? 5 : 40;
        if (calls !== expectedCalls) throw new Error("Unexpected upstream request count: " + calls);
        serverResults.push({ variant, scenario, round, elapsedMs, upstreamRequests: calls });
      } finally { await close(gateway); await close(upstream); }
    }
  }
}
const report = { recordedAt: new Date().toISOString(), baseline: "21edd7e66c760e9e8da49d0e6fa86ae865de4bf2", cpu: cpus()[0]?.model, browser: browserVersion, node: process.version, bundleHashes: Object.fromEntries(await Promise.all(variants.map(async (variant) => [variant, JSON.parse(await readFile(resolve(output, variant + ".json"), "utf8"))]))), phase: after ? "comparison" : "before", extension, server: serverResults, limits: "Browser hot-path microbenchmarks, not whole-extension latency. Server uses local HTTP with a controlled upstream: four simultaneous fetches, 25ms each. No production measurements or AI calls." };
const file = resolve(output, after ? "comparison.json" : "before.json");
await writeFile(file, JSON.stringify(report, null, 2));
console.log(file);
console.log(JSON.stringify({ extension, server: serverResults }, null, 2));
