const fs = require("fs");
const path = require("path");

function main() {
  try {
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const version = pkg.version;
    if (!version) {
      throw new Error("Version not found in package.json");
    }

    const targetPath = path.resolve(
      __dirname,
      "..",
      "..",
      "am-version-check",
      "version.json"
    );

    const payload = { version };
    const content = JSON.stringify(payload, null, 2) + "\n";
    fs.writeFileSync(targetPath, content, "utf8");
    console.log(`[update-version-json] Updated ${targetPath} ->`, payload);
  } catch (err) {
    console.error(
      "[update-version-json] Failed to update version.json:",
      err.message
    );
    process.exitCode = 1;
  }
}

main();
