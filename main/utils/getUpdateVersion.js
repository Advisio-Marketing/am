const { net } = require("electron");
const log = require("electron-log");

const VERSION_URL =
  "https://advisio-marketing.github.io/am-version-check/version.json";

async function getUpdateVersion() {
  try {
    const res = await net.fetch(VERSION_URL, {
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json || typeof json.version !== "string")
      throw new Error("Invalid version.json");
    log.info("UPDATE_VERSION:", json.version);
    return json.version;
  } catch (e) {
    log.warn("Version fetch failed:", e);
    return null;
  }
}

module.exports = { getUpdateVersion };
