#!/usr/bin/env node
/*
  Pushes am-version-check/version.json change to GitHub.

  - Detects repo from am-version-check git remote (or GH_REPO env override)
  - Uses GH_TOKEN or GITHUB_TOKEN; on macOS falls back to Keychain service "am-gh-token"
  - Targets default branch unless GH_BRANCH is set
*/

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const os = require("os");
const { Octokit } = require("@octokit/rest");

const ROOT = path.resolve(__dirname, "..");
const AM_VERSION_CHECK_DIR = path.resolve(ROOT, "..", "am-version-check");

function getPkgVersion() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
  );
  return pkg.version;
}

function ensureExists(p, label) {
  if (!fs.existsSync(p)) throw new Error(`${label || "Path"} not found: ${p}`);
}

function detectOwnerRepo() {
  const envRepo = process.env.GH_REPO || process.env.GITHUB_REPOSITORY;
  if (envRepo && envRepo.includes("/")) {
    const [owner, repo] = envRepo.split("/");
    return { owner, repo };
  }
  ensureExists(AM_VERSION_CHECK_DIR, "am-version-check directory");
  const origin = cp
    .execFileSync(
      "git",
      ["-C", AM_VERSION_CHECK_DIR, "remote", "get-url", "origin"],
      { encoding: "utf8" }
    )
    .trim();
  const m = origin.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);
  if (!m) throw new Error(`Cannot parse GitHub remote: ${origin}`);
  return { owner: m[1], repo: m[2] };
}

function getToken() {
  let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
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
          "[push-version] Loaded token from Keychain (service: am-gh-token)."
        );
    } catch (_) {}
  }
  if (!token)
    throw new Error(
      "GITHUB_TOKEN (or GH_TOKEN) is required to push version.json"
    );
  return token;
}

async function run() {
  const { owner, repo } = detectOwnerRepo();
  const version = getPkgVersion();
  const token = getToken();
  const octokit = new Octokit({ auth: token });

  // Determine target branch
  let branch = process.env.GH_BRANCH;
  if (!branch) {
    const info = await octokit.repos.get({ owner, repo });
    branch = info.data.default_branch || "main";
  }

  // Prepare content
  const contentObj = { version };
  const contentStr = JSON.stringify(contentObj, null, 2) + "\n";
  const contentB64 = Buffer.from(contentStr, "utf8").toString("base64");
  const filePath = "version.json";

  // Get existing file SHA (if exists)
  let sha;
  try {
    const res = await octokit.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: branch,
    });
    if (!Array.isArray(res.data) && res.data && res.data.sha)
      sha = res.data.sha;
  } catch (e) {
    // 404 is ok (new file)
    if (e.status !== 404) throw e;
  }

  const message = `chore(version): v${version}`;
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message,
    content: contentB64,
    sha,
    branch,
  });
  console.log(
    `[push-version] Committed ${filePath} to ${owner}/${repo}@${branch} as ${message}`
  );
}

run().catch((err) => {
  const status = err.status || err?.response?.status;
  if (status === 403) {
    console.error("[push-version] 403 Forbidden. Possible causes:");
    console.error(
      "- Token lacks repo write permissions (classic: repo; fine-grained: Contents: Read & write)."
    );
    console.error(
      "- Token not SSO-enabled for the org. Enable SSO for the token."
    );
    console.error(
      "- Branch protection requires PRs (then push via PR instead)."
    );
  }
  console.error("[push-version] Failed:", err.message);
  process.exit(1);
});
