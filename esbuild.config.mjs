import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "cjs",
  target: "es2020",
  platform: "browser",
  outfile: "main.js",
  // Provided by Obsidian at runtime (and shared with orgmode-cm6).
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  logLevel: "info",
});

if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
