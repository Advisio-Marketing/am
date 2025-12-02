#!/usr/bin/env node
/*
  Publishes two GitHub releases to the am-version-check repo:
  - am-mac: zipped DMG for arm64
  - am-win: zipped EXE for x64 (NSIS "Setup" exe)

  Requirements:
  - env GITHUB_TOKEN must be set (repo scope)
  - am-version-check must be a git repo with a valid origin remote, or set env GH_REPO="owner/repo"
  - zip CLI available (macOS default)

  Options:
  --dry-run        Don't call GitHub, just print what would happen
  --mac-version    Override version used for mac artifact lookup
  --win-version    Override version used for win artifact lookup
*/

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const os = require("os");

const { Octokit } = require("@octokit/rest");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.resolve(ROOT, "dist", "electron");
const AM_VERSION_CHECK_DIR = path.resolve(ROOT, "..", "am-version-check");

// Resolve mac_help.txt from preferred locations
function resolveMacHelpPath() {
  const p1 = path.resolve(ROOT, "dist", "renderer", "assets", "mac_help.txt");
  const p2 = path.resolve(ROOT, "renderer", "public", "assets", "mac_help.txt");
  const p3 = path.resolve(ROOT, "assets", "mac_help.txt");
  if (fs.existsSync(p1)) return p1;
  if (fs.existsSync(p2)) return p2;
  if (fs.existsSync(p3)) return p3;
  throw new Error(
    "mac_help.txt not found. Checked: dist/renderer/assets/mac_help.txt, renderer/public/assets/mac_help.txt, assets/mac_help.txt"
  );
}

// Resolve win_help.txt from preferred locations
function resolveWinHelpPath() {
  const p1 = path.resolve(ROOT, "dist", "renderer", "assets", "win_help.txt");
  const p2 = path.resolve(ROOT, "renderer", "public", "assets", "win_help.txt");
  const p3 = path.resolve(ROOT, "assets", "win_help.txt");
  if (fs.existsSync(p1)) return p1;
  if (fs.existsSync(p2)) return p2;
  if (fs.existsSync(p3)) return p3;
  throw new Error(
    "win_help.txt not found. Checked: dist/renderer/assets/win_help.txt, renderer/public/assets/win_help.txt, assets/win_help.txt"
  );
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--mac-version") opts.macVersion = args[++i];
    else if (a === "--win-version") opts.winVersion = args[++i];
  }
  return opts;
}

function getPkgVersion() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
  );
  return pkg.version;
}

function ensureExists(p, label) {
  if (!fs.existsSync(p)) {
    throw new Error(`${label || "Path"} not found: ${p}`);
  }
}

function findArtifactMac(_versionIgnored) {
  // New invariant name
  const p = path.join(DIST, "am.dmg");
  return fs.existsSync(p) ? p : null;
}

function findArtifactWin(_versionIgnored) {
  const p = path.join(DIST, "am.exe");
  return fs.existsSync(p) ? p : null;
}

function zipFile(inputPath) {
  const zipPath = `${inputPath}.zip`;
  // Use zip CLI to create a zip containing only the single file (-j to junk paths)
  cp.execFileSync("zip", ["-j", "-q", zipPath, inputPath], {
    stdio: "inherit",
  });
  return zipPath;
}

function zipDmgWithHelp(dmgPath, helpPath) {
  const zipPath = `${dmgPath}.zip`;
  // Create zip with both DMG and mac_help.txt at root
  cp.execFileSync("zip", ["-j", "-q", zipPath, dmgPath, helpPath], {
    stdio: "inherit",
  });
  return zipPath;
}

function ensureHelpInZip(zipPath, helpPath) {
  // Update or add help file into existing zip; if it fails (some zip variants), recreate zip.
  try {
    cp.execFileSync("zip", ["-j", "-u", "-q", zipPath, helpPath], {
      stdio: "inherit",
    });
  } catch (e) {
    const dir = path.dirname(zipPath);
    const base = path.basename(zipPath, ".zip");
    const original = `${base}`; // path without .zip
    // Recreate zip from scratch
    console.warn(
      `[publish] zip -u failed for ${zipPath}, recreating the zip with help file...`
    );
    // Remove old zip then create new one with both files
    try {
      fs.unlinkSync(zipPath);
    } catch (_) {}
    const input = path.join(dir, base);
    // input may include spaces; we already have zipPath = input + '.zip'
    // Rebuild zip using the executable/dmg path and helpPath
    // Detect actual input file path by removing trailing .zip from zipPath
    const inputPath = zipPath.replace(/\.zip$/, "");
    cp.execFileSync("zip", ["-j", "-q", zipPath, inputPath, helpPath], {
      stdio: "inherit",
    });
  }
}

function zipExeWithHelp(exePath, helpPath) {
  const zipPath = `${exePath}.zip`;
  // Create zip with both EXE and win_help.txt at root
  cp.execFileSync("zip", ["-j", "-q", zipPath, exePath, helpPath], {
    stdio: "inherit",
  });
  return zipPath;
}

function detectOwnerRepo() {
  // Allow override via env GH_REPO="owner/repo" or GITHUB_REPOSITORY
  const envRepo = process.env.GH_REPO || process.env.GITHUB_REPOSITORY;
  if (envRepo && envRepo.includes("/")) {
    const [owner, repo] = envRepo.split("/");
    return { owner, repo };
  }
  try {
    // Read origin URL from am-version-check
    ensureExists(AM_VERSION_CHECK_DIR, "am-version-check directory");
    const origin = cp
      .execFileSync(
        "git",
        ["-C", AM_VERSION_CHECK_DIR, "remote", "get-url", "origin"],
        { encoding: "utf8" }
      )
      .trim();
    // Parse git@github.com:Owner/repo.git or https://github.com/Owner/repo.git
    let m = origin.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);
    if (!m) throw new Error(`Cannot parse GitHub remote: ${origin}`);
    return { owner: m[1], repo: m[2] };
  } catch (e) {
    throw new Error(
      'Cannot detect GitHub repo for am-version-check. Set env GH_REPO="owner/repo" or configure git remote. ' +
        e.message
    );
  }
}

async function cleanupOldReleases(
  octokit,
  { owner, repo, channelName, keepTag, dryRun }
) {
  // Delete releases whose name matches channelName and tag_name != keepTag, and delete their tags
  if (dryRun) {
    console.log(
      `[publish] Would delete previous releases for ${channelName} keeping tag ${keepTag}`
    );
    return;
  }
  const releases = await octokit.paginate(octokit.repos.listReleases, {
    owner,
    repo,
    per_page: 100,
  });
  for (const r of releases) {
    if (r.name !== channelName) continue;
    if (r.tag_name === keepTag) continue;
    try {
      await octokit.repos.deleteRelease({ owner, repo, release_id: r.id });
      if (r.tag_name) {
        try {
          await octokit.git.deleteRef({
            owner,
            repo,
            ref: `tags/${r.tag_name}`,
          });
        } catch (e) {
          if (e.status !== 422 && e.status !== 404) throw e; // ignore if tag already missing
        }
      }
      console.log(
        `[publish] Deleted old release ${channelName} (${r.tag_name}) and tag.`
      );
    } catch (e) {
      if (e.status === 404) continue;
      throw e;
    }
  }
}

async function ensureRelease(
  octokit,
  { owner, repo, tag, name, body, draft = false, prerelease = false }
) {
  try {
    const { data } = await octokit.repos.createRelease({
      owner,
      repo,
      tag_name: tag,
      name,
      body,
      draft,
      prerelease,
    });
    return data;
  } catch (err) {
    if (err.status === 422) {
      // Possibly already exists; try to get by tag
      const { data } = await octokit.repos.getReleaseByTag({
        owner,
        repo,
        tag,
      });
      return data;
    }
    throw err;
  }
}

async function uploadOrReplaceAsset(
  octokit,
  { owner, repo, release, filePath }
) {
  const fsPromises = fs.promises;
  const stat = await fsPromises.stat(filePath);
  const name = path.basename(filePath);
  // Robustly find and delete existing asset (don't rely on possibly-stale release.assets)
  const assets = await octokit.paginate(octokit.repos.listReleaseAssets, {
    owner,
    repo,
    release_id: release.id,
    per_page: 100,
  });
  const existing = assets.find((a) => a.name === name);
  if (existing) {
    await octokit.repos.deleteReleaseAsset({
      owner,
      repo,
      asset_id: existing.id,
    });
  }
  const headers = {
    "content-type": "application/zip",
    "content-length": stat.size,
  };
  const data = await fsPromises.readFile(filePath);
  async function doUpload() {
    return octokit.repos.uploadReleaseAsset({
      owner,
      repo,
      release_id: release.id,
      name,
      headers,
      data,
    });
  }
  try {
    const res = await doUpload();
    return res.data;
  } catch (err) {
    // Retry once if GitHub still reports duplicate
    if (err.status === 422 && /already_exists/.test(String(err.message))) {
      const again = await octokit.paginate(octokit.repos.listReleaseAssets, {
        owner,
        repo,
        release_id: release.id,
        per_page: 100,
      });
      const dup = again.find((a) => a.name === name);
      if (dup) {
        await octokit.repos.deleteReleaseAsset({
          owner,
          repo,
          asset_id: dup.id,
        });
      }
      const res2 = await doUpload();
      return res2.data;
    }
    throw err;
  }
}

async function main() {
  const opts = parseArgs();
  const baseVersion = getPkgVersion();
  const macVersion = opts.macVersion || baseVersion;
  const winVersion = opts.winVersion || baseVersion;

  if (!fs.existsSync(DIST)) {
    console.warn(`[publish] Dist directory not found: ${DIST}`);
  }

  // Locate artifacts (non-throwing)
  const macDmg = fs.existsSync(DIST) ? findArtifactMac(macVersion) : null;
  const winExe = fs.existsSync(DIST) ? findArtifactWin(winVersion) : null;

  // Zip artifacts
  const macZip = macDmg ? `${macDmg}.zip` : null;
  const winZip = winExe ? `${winExe}.zip` : null;

  if (macDmg) {
    // Ensure mac_help.txt is included inside the DMG zip
    const helpPath = resolveMacHelpPath();
    if (!fs.existsSync(macZip)) {
      zipDmgWithHelp(macDmg, helpPath);
    } else {
      console.log(`[publish] Using existing zip: ${macZip}`);
      ensureHelpInZip(macZip, helpPath);
    }
  }
  if (winExe) {
    // Ensure win_help.txt is included inside the EXE zip
    const winHelp = resolveWinHelpPath();
    if (!fs.existsSync(winZip)) {
      zipExeWithHelp(winExe, winHelp);
    } else {
      console.log(`[publish] Using existing zip: ${winZip}`);
      ensureHelpInZip(winZip, winHelp);
    }
  }

  const { owner, repo } = detectOwnerRepo();
  let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  // Fallback to macOS Keychain if no env var is present
  if (!token && process.platform === "darwin") {
    try {
      const user = process.env.USER || os.userInfo().username;
      token = cp
        .execFileSync(
          "security",
          ["find-generic-password", "-a", user, "-s", "am-gh-token", "-w"],
          { encoding: "utf8" }
        )
        .trim();
      if (token)
        console.log(
          "[publish] Loaded token from Keychain (service: am-gh-token)."
        );
    } catch (_) {
      // ignore, will error below if still missing
    }
  }

  console.log(`[publish] Target repo: ${owner}/${repo}`);
  console.log(`[publish] mac: ${macZip || "N/A"}, win: ${winZip || "N/A"}`);

  if (opts.dryRun) {
    console.log("[publish] Dry run – no network calls.");
    if (macZip) {
      console.log(
        `[publish] Would delete previous releases for am-mac keeping tag am-mac-v${macVersion}`
      );
      console.log(
        `[publish] Would create or reuse release: name=am-mac, tag=am-mac-v${macVersion}`
      );
      console.log(`[publish] Would upload asset: ${path.basename(macZip)}`);
    }
    if (winZip) {
      console.log(
        `[publish] Would delete previous releases for am-win keeping tag am-win-v${winVersion}`
      );
      console.log(
        `[publish] Would create or reuse release: name=am-win, tag=am-win-v${winVersion}`
      );
      console.log(`[publish] Would upload asset: ${path.basename(winZip)}`);
    }
    if (!macZip && !winZip) console.log("[publish] No artifacts found.");
    return;
  }

  if (!token)
    throw new Error("GITHUB_TOKEN env var is required to publish releases.");
  const octokit = new Octokit({ auth: token });

  // Publish mac release (if artifact exists)
  if (macZip) {
    await cleanupOldReleases(octokit, {
      owner,
      repo,
      channelName: "am-mac",
      keepTag: `am-mac-v${macVersion}`,
    });
    const macRelease = await ensureRelease(octokit, {
      owner,
      repo,
      tag: `am-mac-v${macVersion}`,
      name: "am-mac",
      body: `AM macOS release for version ${macVersion}. Artifact name: am.dmg`,
    });
    await uploadOrReplaceAsset(octokit, {
      owner,
      repo,
      release: macRelease,
      filePath: macZip,
    });
    console.log(`[publish] Uploaded asset to am-mac: ${path.basename(macZip)}`);
  } else {
    console.warn("[publish] mac artifact not found – skipping mac release.");
  }

  // Publish win release (if artifact exists)
  if (winZip) {
    await cleanupOldReleases(octokit, {
      owner,
      repo,
      channelName: "am-win",
      keepTag: `am-win-v${winVersion}`,
    });
    const winRelease = await ensureRelease(octokit, {
      owner,
      repo,
      tag: `am-win-v${winVersion}`,
      name: "am-win",
      body: `AM Windows release for version ${winVersion}. Artifact name: am.exe`,
    });
    await uploadOrReplaceAsset(octokit, {
      owner,
      repo,
      release: winRelease,
      filePath: winZip,
    });
    console.log(`[publish] Uploaded asset to am-win: ${path.basename(winZip)}`);
  } else {
    console.warn("[publish] win artifact not found – skipping win release.");
  }
}

main().catch((err) => {
  const status = err.status || err?.response?.status;
  if (status === 403) {
    console.error("[publish] Failed with 403 (forbidden).");
    console.error("[publish] Likely causes:");
    console.error(
      "- Token lacks permissions (need repo scope or Contents: Read & write for fine-grained)."
    );
    console.error(
      "- Token not authorized for org via SSO (click Enable SSO for the token)."
    );
    console.error(
      "- Token does not include the am-version-check repository (for fine-grained tokens)."
    );
  }
  console.error("[publish] Failed:", err.message);
  process.exit(1);
});
