// Bundles src/main.ts into main.js. In watch mode (npm run dev) every rebuild is
// also copied into the test vault, together with manifest.json, styles.css and a
// .hotreload marker so the Hot Reload community plugin picks up changes.
// Set OBSIDIAN_PLUGIN_DIR to copy into a different plugin folder instead.
import esbuild from "esbuild";
import builtins from "builtin-modules";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const production = process.argv[2] === "production";
const pluginDir =
  process.env.OBSIDIAN_PLUGIN_DIR ?? join("test-vault", ".obsidian", "plugins", "story-planner");

const copyToVault = {
  name: "copy-to-vault",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      mkdirSync(pluginDir, { recursive: true });
      for (const file of ["main.js", "manifest.json", "styles.css"]) {
        copyFileSync(file, join(pluginDir, file));
      }
      writeFileSync(join(pluginDir, ".hotreload"), "");
      console.log(`[story-planner] built and copied to ${pluginDir}`);
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "@lezer/*",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
  plugins: [copyToVault],
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
