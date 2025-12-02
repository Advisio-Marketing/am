/*
 Adds assets/mac_help.txt to all macOS ZIP artifacts produced by electron-builder.
 - Expects ZIP files in dist/electron with artifactName pattern: "AM ${version} ${arch}.zip".
 - Puts mac_help.txt at the root of the ZIP.

 This script is idempotent (zip -u updates or adds the file).
*/
const fs = require("fs");
const path = require("path");
const { execFileSync, execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist", "electron");
const helpInDistRenderer = path.join(
  root,
  "dist",
  "renderer",
  "assets",
  "mac_help.txt"
);
const helpInRendererPublic = path.join(
  root,
  "renderer",
  "public",
  "assets",
  "mac_help.txt"
);
const helpInRepoAssets = path.join(root, "assets", "mac_help.txt");
const tempHelpPath = path.join(outDir, "mac_help.txt");

function ensureOutDir() {
  if (!fs.existsSync(outDir)) {
    console.warn("[mac-zip] Output directory not found:", outDir);
    process.exit(0);
  }
}

function resolveSourceHelpPath() {
  if (fs.existsSync(helpInDistRenderer)) return helpInDistRenderer;
  if (fs.existsSync(helpInRendererPublic)) return helpInRendererPublic;
  if (fs.existsSync(helpInRepoAssets)) return helpInRepoAssets;
  console.error(
    "[mac-zip] Missing mac_help.txt. Checked: dist/renderer/assets/mac_help.txt, renderer/public/assets/mac_help.txt, assets/mac_help.txt"
  );
  process.exit(1);
}

function copyHelpToOutDir() {
  const src = resolveSourceHelpPath();
  fs.copyFileSync(src, tempHelpPath);
}

function isMacZip(zipPath) {
  try {
    // List archive contents and check for .app bundle
    const listing = execSync(
      `unzip -Z1 ${JSON.stringify(path.basename(zipPath))}`,
      {
        cwd: outDir,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
      }
    );
    return listing
      .split("\n")
      .some((l) => l.trim().endsWith(".app/") || l.includes(".app/"));
  } catch {
    return false;
  }
}

function addHelpToZip(zipPath) {
  // Use zip -u to update/add and -j to junk the path (place at zip root)
  execFileSync(
    "zip",
    ["-uj", path.basename(zipPath), path.basename(tempHelpPath)],
    {
      cwd: outDir,
      stdio: "inherit",
    }
  );
}

function run() {
  ensureOutDir();
  // Validate that a source help file exists (resolveSourceHelpPath exits with code 1 if missing)
  resolveSourceHelpPath();

  const files = fs.readdirSync(outDir);
  const zipFiles = files.filter((f) => f.toLowerCase().endsWith(".zip"));

  if (zipFiles.length === 0) {
    console.warn("[mac-zip] No ZIP artifacts found in:", outDir);
    return;
  }

  copyHelpToOutDir();

  for (const z of zipFiles) {
    // Only patch macOS zips containing an .app bundle
    if (!isMacZip(path.join(outDir, z))) {
      continue;
    }
    try {
      addHelpToZip(path.join(outDir, z));
      console.log(`[mac-zip] Injected mac_help.txt into: ${z}`);
    } catch (e) {
      console.error(`[mac-zip] Failed to update ${z}:`, e.message);
      process.exitCode = 1;
    }
  }

  // Clean up temp file (optional, keep it so repeated updates are cheap)
  try {
    fs.unlinkSync(tempHelpPath);
  } catch {}
}

run();
