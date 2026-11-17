import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dir, "../..");
const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1]! : "codex/manual-notes-local";
const git = (args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
};
const baseCommit = git(["rev-parse", base]).toString().trim();
const modulesOnly = process.argv.includes("--modules-only");
const anchorPath = "src/everything-extension/utils/anchor.ts";
const mountPath = "src/everything-extension/utils/mountInlineNotes.tsx";
const originalAnchor = git(["show", `${baseCommit}:${anchorPath}`]);
const originalMount = git(["show", `${baseCommit}:${mountPath}`]);
const optimizedAnchor = await readFile(resolve(root, anchorPath));
const optimizedMount = await readFile(resolve(root, mountPath));
const hash = (source: Uint8Array) => createHash("sha256").update(source).digest("hex");
if (hash(originalAnchor) === hash(optimizedAnchor) || hash(originalMount) === hash(optimizedMount)) throw new Error("Both optimizations must be present before building the four-way comparison.");
const bun = [resolve(root, "../.tools/bun-windows-x64/bun.exe"), resolve(root, ".local-test/tools/bun-windows-x64/bun.exe")].find(existsSync);
if (!bun) throw new Error("Run the Windows local setup first.");
const perf = resolve(root, ".local-test/performance");
await mkdir(perf, { recursive: true });
try {
  for (const variant of ["baseline", "filter", "index", "both"]) {
    const anchor = variant === "index" || variant === "both" ? optimizedAnchor : originalAnchor;
    const mount = variant === "filter" || variant === "both" ? optimizedMount : originalMount;
    await writeFile(resolve(root, anchorPath), anchor);
    await writeFile(resolve(root, mountPath), mount);
    const destination = resolve(perf, "variants", variant);
    await mkdir(destination, { recursive: true });
    if (!modulesOnly) {
      const result = Bun.spawnSync([bun, "x", "--bun", "wxt", "build", "--mode", "manual-test"], { cwd: resolve(root, "src/everything-extension"), env: { ...process.env, PATH: `${resolve(bun, "..")}\u003b${process.env.PATH}` } });
      await writeFile(resolve(perf, `build-${variant}.log`), Buffer.concat([result.stdout, result.stderr]));
      if (result.exitCode !== 0) throw new Error(`Build failed: read .local-test/performance/build-${variant}.log`);
      await cp(resolve(root, "src/everything-extension/.output/chrome-mv3-manual-test"), destination, { recursive: true });
    }
    const indexBuild = await Bun.build({ entrypoints: [resolve(root, anchorPath)], target: "browser", format: "esm" });
    if (!indexBuild.success) throw new Error(`Index benchmark module build failed: ${indexBuild.logs.join("\n")}`);
    await writeFile(resolve(destination, "anchor.mjs"), await indexBuild.outputs[0]!.text());
    await writeFile(resolve(destination, "variant.json"), JSON.stringify({ variant, baseCommit, anchorSourceHash: hash(anchor), mountSourceHash: hash(mount), mutationHelperHash: hash(await readFile(resolve(root, "src/everything-extension/utils/articleMutations.ts"))), noteScriptHash: hash(await readFile(resolve(destination, "content-scripts/notes.js"))) }, null, 2));
    console.log(`Built ${variant} from ${baseCommit.slice(0, 7)} with recorded source and bundle hashes.`);
  }
} finally {
  // Never leave the checkout on a temporary benchmark variant.
  await writeFile(resolve(root, anchorPath), optimizedAnchor);
  await writeFile(resolve(root, mountPath), optimizedMount);
}
