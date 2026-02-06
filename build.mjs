import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const isWatch = process.argv.includes("--watch");

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });

const writeManifest = () => {
  const manifestPath = path.join(SRC, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  ensureDir(DIST);
  fs.writeFileSync(path.join(DIST, "manifest.json"), JSON.stringify(manifest, null, 2));
};

const copyStatic = () => {
  const optionsDir = path.join(DIST, "options");
  ensureDir(optionsDir);
  fs.copyFileSync(
    path.join(SRC, "options", "options.html"),
    path.join(optionsDir, "options.html")
  );
};

const build = async () => {
  ensureDir(DIST);

  await esbuild.build({
    entryPoints: {
      "sw/service_worker": path.join(SRC, "sw", "service_worker.ts"),
      "content/content_script": path.join(SRC, "content", "content_script.ts"),
      "options/options": path.join(SRC, "options", "options.ts")
    },
    bundle: true,
    outdir: DIST,
    format: "esm",
    platform: "browser",
    target: ["chrome120"],
    sourcemap: true
  });

  writeManifest();
  copyStatic();
};

if (isWatch) {
  const ctx = await esbuild.context({
    entryPoints: {
      "sw/service_worker": path.join(SRC, "sw", "service_worker.ts"),
      "content/content_script": path.join(SRC, "content", "content_script.ts"),
      "options/options": path.join(SRC, "options", "options.ts")
    },
    bundle: true,
    outdir: DIST,
    format: "esm",
    platform: "browser",
    target: ["chrome120"],
    sourcemap: true
  });

  await ctx.watch();
  writeManifest();
  copyStatic();
} else {
  await build();
}
