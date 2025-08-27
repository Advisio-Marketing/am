const { app, dialog, shell } = require("electron");
const process = require("node:process");
const log = require("electron-log");
let ZIP_URL = null;

async function showStartupDialog(mainWindow, version) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  log.info("platform", process?.platform);
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "AM update",
    message: `Je dostupný update aplikace pro verzi ${version}. Pro stažení klikněte na Aktualizovat! Po potvrzení bude aplikace zavřena a je potřeba nainstalovat stažený soubor.`,
    buttons: ["Aktualizovat"],
    cancelId: 1, // pro jistotu
    noLink: true,
  });

  if (response === 0) {
    if (process.platform === "darwin") {
      ZIP_URL = `https://github.com/Advisio-Marketing/easy-access-version-check/releases/download/easy_access_mac/Easy.Access.${version}.arm64.dmg.zip`;
    } else if (process.platform === "win32") {
      ZIP_URL = `https://github.com/Advisio-Marketing/easy-access-version-check/releases/download/easy_access_win/Easy.Access.${version}.x64.exe.zip`;
    }
    await shell.openExternal(ZIP_URL);
    try {
    } catch (e) {
      log.error("Version update errror: ", e);
    }

    try {
      if (!mainWindow.isDestroyed()) mainWindow.hide();
    } catch {}

    setTimeout(() => {
      app.quit();
    }, 50);
  }
}

module.exports = { showStartupDialog };
