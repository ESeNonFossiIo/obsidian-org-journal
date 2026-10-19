// Bundles src/main.js (and the modules it imports) into main.js, the single file
// Obsidian loads. `node esbuild.config.mjs` builds once; `--watch` rebuilds on change.
// Obsidian and CodeMirror are marked external: Obsidian provides them at runtime,
// and sharing its CodeMirror copy is what lets us extend orgmode-cm6's editor.
//
// Deploying: after each successful build, main.js, manifest.json and styles.css are
// copied into a vault's plugin folder if a target is configured, either with the
// OBSIDIAN_PLUGIN_DIR environment variable or a one-line `.deploy-target` file
// (gitignored), e.g. ~/vault/.obsidian/plugins/org-journal. The target must be a
// real folder, not a symlink: Syncthing does not follow symlinks, so a symlinked
// plugin never reaches the phone.
import esbuild from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const watch = process.argv.includes("--watch");
const FILES = ["main.js", "manifest.json", "styles.css"];

/** Configured deploy folder (with ~ expanded), or null if none. */
function deployTarget() {
  let dir = process.env.OBSIDIAN_PLUGIN_DIR;
  if (!dir && existsSync(".deploy-target")) dir = readFileSync(".deploy-target", "utf8").trim();
  return dir ? dir.replace(/^~(?=\/|$)/, homedir()) : null;
}

/** Copy the built plugin files into the deploy folder, if there is one. */
function deploy() {
  const dir = deployTarget();
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  for (const f of FILES) copyFileSync(f, join(dir, f));
  console.log(`deployed ${FILES.join(", ")} -> ${dir}`);
}

const ctx = await esbuild.context({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "cjs",
  target: "es2020",
  platform: "browser",
  outfile: "main.js",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  logLevel: "info",
  plugins: [{
    name: "deploy",
    setup(build) { build.onEnd((result) => { if (!result.errors.length) deploy(); }); },
  }],
});

if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
