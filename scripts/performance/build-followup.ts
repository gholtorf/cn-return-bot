import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dir, "../..");
const output = resolve(root, ".local-test/followup");
await mkdir(output, { recursive: true });
const baseline = "21edd7e66c760e9e8da49d0e6fa86ae865de4bf2";
const paths = ["src/everything-extension/utils/anchorGroups.ts", "src/everything-extension/utils/claimGroups.ts"];
const originals = paths.map((path) => {
  const result = Bun.spawnSync(["git", "show", baseline + ":" + path], { cwd: root });
  if (result.exitCode) throw new Error(result.stderr.toString());
  return result.stdout.toString();
});
const variants = process.argv.includes("--after") ? ["baseline", "lazy", "groups", "both"] : ["baseline"];
for (const variant of variants) {
  const result = await Bun.build({
    entrypoints: [resolve(root, "scripts/performance/followup-browser.ts")], target: "browser", format: "esm", minify: true,
    define: { "import.meta.env": JSON.stringify({ VITE_SUPABASE_URL: "http://127.0.0.1:54321", VITE_SUPABASE_ANON_KEY: "local-benchmark-no-network" }) },
    plugins: [{ name: "immutable-baseline", setup(build) {
      build.onLoad({ filter: /[\\/](anchorGroups|claimGroups)\.ts$/ }, async ({ path }) => {
        const index = path.endsWith("anchorGroups.ts") ? 0 : 1;
        const optimized = variant === "both" || (index === 0 ? variant === "lazy" : variant === "groups");
        return { contents: optimized ? await readFile(path, "utf8") : originals[index]!, loader: "ts" };
      });
    } }],
  });
  if (!result.success) throw new Error(result.logs.join("\n"));
  const contents = await result.outputs[0]!.text();
  await writeFile(resolve(output, variant + ".mjs"), contents);
  await writeFile(resolve(output, variant + ".json"), JSON.stringify({ baseline, sha256: createHash("sha256").update(contents).digest("hex") }, null, 2));
  console.log("Built " + variant);
}
