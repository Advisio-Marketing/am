#!/usr/bin/env node
/**
 * Build orchestrator to ensure `npm run build` produces both macOS and Windows artifacts
 * before publishing. Behavior by platform:
 * - darwin (macOS): build mac DMG and try to build Windows x64 via electron-builder.
 *   If Windows build fails due to missing Wine/Mono on Apple Silicon, print a clear
 *   warning and continue (mac artifact will still publish; win will be skipped by publisher).
 * - win32 (Windows): build Windows x64 only.
 * - linux: build Linux targets only (optional; currently no publish channel is used).
 */

const os = require("os");
const cp = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function run(cmd, args, opts = {}) {
  console.log(`[build-both] $ ${cmd} ${args.join(" ")}`);
  cp.execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
}

function tryRun(cmd, args, opts = {}) {
  try {
    run(cmd, args, opts);
    return true;
  } catch (e) {
    console.warn(`[build-both] Command failed: ${cmd} ${args.join(" ")}`);
    console.warn(`[build-both] ${e.message}`);
    return false;
  }
}

function main() {
  const platform = process.platform; // 'darwin' | 'win32' | 'linux'
  console.log(`[build-both] Platform: ${platform}, arch: ${os.arch()}`);

  if (platform === "darwin") {
    // Always build mac first
    run("npx", ["electron-builder", "--mac", "--publish=never"]);

    // Then attempt Windows build. On Apple Silicon, Wine/Mono are typically unavailable.
    const ok = tryRun("npx", [
      "electron-builder",
      "--win",
      "--x64",
      "--publish=never",
    ]);
    if (!ok) {
      console.warn(
        "[build-both] Windows build on macOS failed (likely missing Wine/Mono on Apple Silicon)."
      );
      console.warn(
        "[build-both] You can build Windows on a Windows machine with `npm run build:win`,"
      );
      console.warn(
        "[build-both] or add a Windows CI job to produce the win artifact."
      );
    }
    return;
  }

  if (platform === "win32") {
    // Build Windows portable only (nsis/zip removed to publish only portable)
    run("npx", ["electron-builder", "--win", "--x64", "--publish=never"]);
    return;
  }

  // Optional: Linux support (kept to mirror existing scripts)
  if (platform === "linux") {
    tryRun("npx", ["electron-builder", "--linux", "--publish=never"]);
    return;
  }

  console.warn("[build-both] Unsupported platform for packaging.");
}

main();
