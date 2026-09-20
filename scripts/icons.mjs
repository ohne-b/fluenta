import * as fs from "node:fs";
import path from "node:path";
import { ROOT, run } from "./build.mjs";

const source = fs.readFileSync(
  path.join(ROOT, "apps/desktop/src/assets/app-icon.svg"),
  "utf8",
);
const [x, y, width, height] = source
  .match(/viewBox="([^"]+)"/)[1]
  .split(" ")
  .map(Number);
const size = Math.max(width, height);
const directory = path.join(ROOT, ".cache/icons");
fs.mkdirSync(directory, { recursive: true });
const square = source.replace(
  /<svg[^>]+>/,
  `<svg width="${size}" height="${size}" viewBox="${x - (size - width) / 2} ${y - (size - height) / 2} ${size} ${size}" fill="none" xmlns="http://www.w3.org/2000/svg">`,
);
fs.writeFileSync(path.join(directory, "app-icon.svg"), square);
run(process.execPath, [
  path.join(ROOT, "node_modules/@tauri-apps/cli/tauri.js"),
  "icon",
  path.join(directory, "app-icon.svg"),
  "--output",
  directory,
]);
for (const name of [
  "32x32.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.ico",
  "icon.icns",
])
  fs.copyFileSync(
    path.join(directory, name),
    path.join(ROOT, "apps/desktop/src-tauri/icons", name),
  );
