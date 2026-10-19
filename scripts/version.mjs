// Sets the plugin's version everywhere it is written: `npm run version-bump -- 0.2.0`.
// Updates manifest.json and package.json, and records the version in
// versions.json with the minimum Obsidian version it needs.
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Give a version such as 0.2.0: npm run version-bump -- 0.2.0");
  process.exit(1);
}
const write = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + "\n");

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = version;
write("manifest.json", manifest);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.version = version;
write("package.json", pkg);

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[version] = manifest.minAppVersion;
write("versions.json", versions);

console.log(`Version ${version}. Commit, then tag it: git tag ${version} && git push origin ${version}`);
