// --- Imports ---
const {
  app,
  BaseWindow,
  WebContentsView,
  session,
  net,
  ipcMain,
} = require("electron");
const path = require("path");
const fs = require("node:fs").promises;
const log = require("electron-log/main");
const API_TOKEN = `advisio_api_2025_secure`;

const { getUpdateVersion } = require("./utils/getUpdateVersion");
const { showStartupDialog } = require("./utils/dialog");

log.transports.console.level = "silly";

// Preload loader HTML into memory to minimize I/O latency when showing loader
let LOADER_HTML_CACHE = null;
async function ensureLoaderHtml() {
  if (LOADER_HTML_CACHE) return LOADER_HTML_CACHE;
  try {
    const loaderPath = path.join(__dirname, "../renderer/loading.html");
    LOADER_HTML_CACHE = await fs.readFile(loaderPath, "utf-8");
    return LOADER_HTML_CACHE;
  } catch (e) {
    log.warn("Failed to read loading.html, falling back to inline loader:", e);
    LOADER_HTML_CACHE = `<!doctype html><html><head><meta charset=\"utf-8\"/><title>Načítání…</title><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/><style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#0b1220;color:#fff;font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif}.card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:16px;padding:28px 32px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.25);backdrop-filter:blur(6px)}.dots{display:inline-flex;gap:6px;margin-left:8px}.dot{width:6px;height:6px;border-radius:50%;background:#7dc7ff;opacity:.4;animation:b 1.2s infinite ease-in-out}.dot:nth-child(2){animation-delay:.15s}.dot:nth-child(3){animation-delay:.3s}@keyframes b{0%,80%,100%{opacity:.35;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}</style></head><body><div class=\"card\"><div style=\"font-size:15px;letter-spacing:.2px;opacity:.9\">Načítání<span class=\"dots\"><span class=\"dot\"></span><span class=\"dot\"></span><span class=\"dot\"></span></span></div></div></body></html>`;
    return LOADER_HTML_CACHE;
  }
}

async function showLocalLoader(webContents) {
  try {
    const html = await ensureLoaderHtml();
    const baseUrl = `file://${path.join(__dirname, "../renderer/")}`;
    await webContents.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
      { baseURLForDataURL: baseUrl }
    );
  } catch (e) {
    log.warn("showLocalLoader failed, fallback to loadFile:", e);
    try {
      const loaderPath = path.join(__dirname, "../renderer/loading.html");
      await webContents.loadFile(loaderPath);
    } catch (err) {
      log.error("Fallback loader loadFile also failed:", err);
    }
  }
}

// Google Auth Manager - s error handling
let GoogleAuthManager = null;
try {
  GoogleAuthManager = require("./google-auth-manager");
} catch (error) {
  log.error("Failed to load GoogleAuthManager:", error);
}
let is;
try {
  ({ is } = require("@electron-toolkit/utils"));
} catch {
  is = { dev: !app.isPackaged };
}
let optimizer;
try {
  ({ optimizer } = require("@electron-toolkit/utils"));
} catch {
  optimizer = { watchWindowShortcuts: () => {} };
}
let electronApp;
try {
  ({ electronApp } = require("@electron-toolkit/utils"));
} catch {
  electronApp = { setAppUserModelId: () => {} };
}
// --------------

// --- Globální Proměnné ---
let mainWindow = null;
let reactUiView = null;
let mergadoView = null; // standalone (legacy) Mergado view
// webViews keyed by per-tab unique id (tabId/viewId). Each entry keeps the original accountId for metadata/cookies
let webViews = {}; // { [tabId]: { view: WebContentsView, session: Session, url: string, name: string, system: string, accountId?: string } }
let activeWebViewId = null;
let accountList = null; // Seznam účtů, načte se až na vyžádání
let SIDEBAR_WIDTH = 250;
let TAB_BAR_HEIGHT = 40;
let isMainLayoutActive = false; // Začínáme s úvodní obrazovkou
let googleAuthManager = null; // Google OAuth manager
let hasShownUpdateDialog = false;
let isOverlayOpen = false; // when true, hide native web views so React modals are visible

// --- Statické Consent Cookies ---
const consentCookies = {
  ocm_consent: "1",
  didomi_token:
    "eyJ1c2VyX2lkIjoiMTk2MzQ4ZTktMDlhYi02YzUyLWI5ZTUtOWZlMWUxN2RjMWI4IiwiY3JlYXRlZCI6IjIwMjUtMDQtMTRUMTM6NDg6MDAuNTM4WiIsInVwZGF0ZWQiOiIyMDI1LTA0LTE0VDEzOjQ4OjIwLjE0OVoiLCJ2ZW5kb3JzIjp7ImVuYWJsZWQiOlsiZ29vZ2xlIiwidHdpdHRlciIsInNhbGVzZm9yY2UiLCJjOnNlbnRyeSIsImM6YmluZy1hZHMiLCJjOnlhaG9vLWFkLWV4Y2hhbmdlIiwiYzp5YWhvby1hbmFseXRpY3MiLCJjOnlvdXR1YmUiLCJjOmhvdGphciIsImM6eWFob28tYWQtbWFuYWdlci1wbHVzIiwiYzpmbGl4bWVkaWEiLCJjOnNhcyIsImM6Z29vZ2xlYW5hLTRUWG5KaWdSIiwiYzpoZXVyZWthIiwiYzpzdGFydHF1ZXN0LUM0NlZLWXFIIiwiYzp5b3R0bHktdzk5aUdkRzMiLCJjOm9uZXNpZ25hbC02RDJVcHJpZiIsImM6dHZub3Zhcy10YzZMMk1qSyIsImM6cHJlYmlkb3JnLUhpamlyWWRiIiwiYzptZWlyby1wUm5DYnlRNyIsImM6dGlrdG9rLWFpZ21KcGplIiwiYzpkaWRvbWkiXX0sInB1cnBvc2VzIjp7ImVuYWJsZWQiOlsiZ2VvbG9jYXRpb25fZGF0YSIsImRldmljZV9jaGFyYWN0ZXJpc3RpY3MiLCJjb252ZXJzaW9uLU55eWFxd3lWIl19LCJ2ZW5kb3JzX2xpIjp7ImVuYWJsZWQiOlsiZ29vZ2xlIiwiYzpoZXVyZWthIiwiYzpzdGFydHF1ZXN0LUM0NlZLWXFIIiwiYzp5b3R0bHktdzk5aUdkRzMiLCJjOm9uZXNpZ25hbC02RDJVcHJpZiJ9LCJwdXJwb3Nlc19saSI6eyJlbjFhYmxlZCI6WyJnZW9fbWFya2V0aW5nX3N0dWRpZXMiXX0sInZlcnNpb24iOjIsImFjIjoiQkVtQUVBRmtDSklBLkJFbUFFQUZrQ0pJQSJ9",
  "euconsent-v2":
    "CQP2yAAQP2yAAAHABBENBkFsAP_gAEPgAATIJ1QPgAFQAMAA0ACAAFQAMAAcABAACQAFoAMgAaAA6AB6AEUAI4ASQAmABQACoAFsAL4AZQA0QBsAG2AQYBCACIAEUAI4ATQAnQBPgCkAFaAMMAaQA5AB4gD9AIGAQiAjgCOgFIAKaAXyA_4EAAI1AR0AmkBSACpAFXQLLAswBbgC4QFzALzAYyBAUCBAEZgJsATqBOuA6ABUADgAIAASAAyABoAEcAJgAUAA0ACEAEQAI4ATQArQBhgDkAH6AQiAjgCOgH_AUgAqQBbgC5gF5gTYAnKBOsAA.f_wACHwAAAAA",
};
// -----------------------------

// --- API Funkce ---

async function fetchAccountListHeureka() {
  log.info("Attempting to fetch account list from API...");
  const requestUrl = "https://app.advisio.cz/api/system-list/heureka/";
  const requestOptions = { method: "GET", url: requestUrl, timeout: 15000 };
  return new Promise((resolve, reject) => {
    const request = net.request(requestOptions);
    request.on("response", (response) => {
      log.info(`API Account List Status Code: ${response.statusCode}`);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return reject(
          new Error(
            `Account list fetch failed with status: ${response.statusCode}`
          )
        );
      }
      let body = "";
      response.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      response.on("end", () => {
        log.info("API account list response finished.");
        log.debug("Raw account list response body:", body);
        fs.writeFile("accounts.json", body, "utf-8");
        try {
          const jsonData = JSON.parse(body);
          if (Array.isArray(jsonData)) {
            log.info(
              `Successfully parsed ${jsonData.length} accounts from JSON.`
            );
            resolve(jsonData);
          } else {
            log.error(
              "Parsed account list response is not an array:",
              jsonData
            );
            reject(new Error("API did not return a valid account list array."));
          }
        } catch (e) {
          log.error("Failed to parse account list JSON:", e);
          reject(new Error(`Failed to parse account list JSON: ${e.message}`));
        }
      });
    });
    request.on("error", (error) => {
      log.error(`API account list request error: ${error.message}`);
      reject(error);
    });
    request.end();
  });
}

async function fetchAccountCookies(accountId) {
  log.info(`Attempting to fetch cookies for account ID: ${accountId}...`);
  const requestUrl = `https://app.advisio.cz/api/system-get/heureka/${accountId}/`;
  const requestOptions = { method: "GET", url: requestUrl, timeout: 15000 };
  return new Promise((resolve, reject) => {
    const request = net.request(requestOptions);
    request.on("response", (response) => {
      log.info(
        `API Cookies [${accountId}] Status Code: ${response.statusCode}`
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return reject(
          new Error(
            `Cookie fetch for ${accountId} failed with status: ${response.statusCode}`
          )
        );
      }
      let body = "";
      response.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      response.on("end", () => {
        log.info(`API cookies response for ${accountId} finished.`);
        log.debug(`Raw cookies response body [${accountId}]:`, body);
        try {
          const jsonData = JSON.parse(body);
          if (jsonData && typeof jsonData === "object") {
            log.info(`Successfully parsed cookies response for ${accountId}.`);
            resolve(jsonData);
          } else {
            log.warn(
              `API response for ${accountId} cookies was not a valid object.`
            );
            resolve(null);
          }
        } catch (e) {
          log.error(`Failed to parse cookies JSON for ${accountId}:`, e);
          reject(e);
        }
      });
    });
    request.on("error", (error) => {
      log.error(`API cookies request error for ${accountId}: ${error.message}`);
      reject(error);
    });
    request.end();
  });
}

async function fetchMergadoCookies() {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await net.fetch("https://app.advisio.cz/api/login/mergado/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ api_token: API_TOKEN }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // načti tělo jako text jen kvůli chybové zprávě (max 200 znaků)
      const errBody = await res.text().catch(() => "");
      throw new Error(
        `HTTP ${res.status} ${res.statusText}: ${errBody.slice(0, 200)}…`
      );
    }

    // TADY je ten rozdíl: parsuj tělo, ne res samotný
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// --- Konec API Funkcí ---

/** Aktualizuje rozložení okna */
function updateMainLayout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const [windowWidth, windowHeight] = mainWindow.getContentSize();
    if (reactUiView && !reactUiView.webContents.isDestroyed()) {
      reactUiView.setBounds({
        x: 0,
        y: 0,
        width: windowWidth,
        height: windowHeight,
      });
    }
    Object.keys(webViews).forEach((id) => {
      const wvInfo = webViews[id];
      if (wvInfo?.view && !wvInfo.view.webContents.isDestroyed()) {
        const isActive = id === activeWebViewId && isMainLayoutActive;
        if (isActive) {
          // Heureka záložky mají místo pro sidebar, Mergado má být full width
          const isMergado = wvInfo.system === "mergado";
          const leftX = isMergado ? 0 : Math.max(SIDEBAR_WIDTH || 0, 0);
          const topY = TAB_BAR_HEIGHT;
          const viewWidth = isMergado ? windowWidth : windowWidth - leftX;
          const viewHeight = isOverlayOpen
            ? 0
            : Math.max(windowHeight - topY, 0);
          wvInfo.view.setBounds({
            x: leftX,
            y: topY,
            width: viewWidth,
            height: viewHeight,
          });
        }
      }
    });

    // If standalone Mergado view exists (legacy full-window flow), keep it below TabBar too
    if (mergadoView && !mergadoView.webContents.isDestroyed()) {
      const topY = TAB_BAR_HEIGHT;
      const viewHeight = isOverlayOpen ? 0 : Math.max(windowHeight - topY, 0);
      mergadoView.setBounds({
        x: 0,
        y: topY,
        width: windowWidth,

        height: viewHeight,
      });
    }
  } catch (e) {
    log.error("Error updating main layout:", e);
  }
}

/** Vytvoří hlavní okno a načte React UI */
async function createWindow() {
  log.info("Creating BaseWindow for AM...");
  if (optimizer?.watchWindowShortcuts) {
    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });
  }
  mainWindow = new BaseWindow({
    width: 1200,
    minWidth: 600,
    height: 800,
    minHeight: 600,
    icon: path.join(
      __dirname,
      "./renderer/public/img/logos/easy-access-logo.ico"
    ),
    show: false,
    autoHideMenuBar: true,
    title: "AM",
    backgroundColor: "#ffffff",
  });
  mainWindow.on("resize", updateMainLayout);
  mainWindow.on("closed", () => {
    webViews = {};
    activeWebViewId = null;
    mainWindow = null;
    reactUiView = null;
    mergadoView = null;
    isMainLayoutActive = false;
    accountList = null;
  });
  reactUiView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: !is.dev,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: is.dev,
    },
  });
  mainWindow.contentView.addChildView(reactUiView);
  log.info("React UI WebContentsView added.");
  function cmpSemver(a, b) {
    const A = String(a)
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
    const B = String(b)
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      const da = A[i] || 0,
        db = B[i] || 0;
      if (da > db) return 1;
      if (da < db) return -1;
    }
    return 0;
  }

  reactUiView.webContents.on("did-finish-load", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      updateMainLayout();
    }
  });
  const viteDevServerUrl =
    process.env["ELECTRON_RENDERER_URL"] || "http://localhost:5173";
  const prodIndexPath = path.join(__dirname, "../dist/renderer/index.html");
  try {
    if (is.dev) {
      await reactUiView.webContents.loadURL(viteDevServerUrl);
    } else {
      await reactUiView.webContents.loadFile(prodIndexPath);
    }
    log.info("React UI finished loading attempt.");
  } catch (error) {
    log.error(
      `Failed to load React UI. Dev=${is.dev}. URL/Path: ${
        is.dev ? viteDevServerUrl : prodIndexPath
      } Error:`,
      error
    );
    try {
      await reactUiView.webContents.loadURL(
        `data:text/html;charset=utf-8,<h1>Chyba načítání UI</h1><p>Nepodařilo se načíst rozhraní aplikace.</p><pre>${error.message}</pre>`
      );
    } catch {}
  }
  log.info("createWindow function finished.");
}

/** Zobrazí/Skryje WebViews podle activeWebViewId */
function showView(viewId) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  log.info(`Attempting to show view for ${viewId || "none"}`);
  let viewToShow = null;
  // Ensure React UI view is present as the base (contains TabBar)
  try {
    if (
      reactUiView &&
      !reactUiView.webContents.isDestroyed() &&
      !mainWindow.contentView.children.includes(reactUiView)
    ) {
      mainWindow.contentView.addChildView(reactUiView);
    }
  } catch (e) {
    log.warn("Failed to ensure reactUiView is present:", e);
  }
  Object.keys(webViews).forEach((id) => {
    const wvInfo = webViews[id];
    const currentView = wvInfo?.view;
    if (currentView && !currentView.webContents.isDestroyed()) {
      if (id === viewId) {
        viewToShow = currentView;
        if (!mainWindow.contentView.children.includes(viewToShow)) {
          try {
            mainWindow.contentView.addChildView(viewToShow);
            log.info(`View for ${id} added.`);
          } catch (e) {
            log.error(`Error adding view ${id}:`, e);
            viewToShow = null;
          }
        }
      } else {
        if (mainWindow.contentView.children.includes(currentView)) {
          try {
            mainWindow.contentView.removeChildView(currentView);
            log.info(`View for ${id} removed.`);
          } catch (e) {
            log.warn(`Error removing view ${id}:`, e);
          }
        }
      }
    } else if (id !== viewId && wvInfo) {
      log.warn(`View for ${id} missing/destroyed, removing map entry.`);
      delete webViews[id];
    }
  });
  activeWebViewId = viewToShow ? viewId : null;
  updateMainLayout();
  if (activeWebViewId) {
    log.info(`View for ${activeWebViewId} is now active.`);
  } else {
    log.info("No view is active.");
  }
}

// --- IPC Handlery ---
ipcMain.handle("google-auth", async () => {
  log.info("IPC: Google authentication requested.");
  try {
    if (!GoogleAuthManager) throw new Error("GoogleAuthManager not available");
    if (!googleAuthManager) googleAuthManager = new GoogleAuthManager();

    const result = await googleAuthManager.getAuthenticatedClient();
    log.info("Google authentication successful:", result.userInfo.email);

    // <<< NAVÁZÁNO NA ÚSPĚŠNÝ LOGIN >>>
    try {
      if (!hasShownUpdateDialog && mainWindow && !mainWindow.isDestroyed()) {
        const current = app.getVersion();
        const latest = await getUpdateVersion(); // může být null

        if (latest && typeof latest === "string") {
          const isNewer = (function cmp(a, b) {
            const A = String(a)
              .split(".")
              .map((n) => parseInt(n, 10) || 0);
            const B = String(b)
              .split(".")
              .map((n) => parseInt(n, 10) || 0);
            for (let i = 0; i < Math.max(A.length, B.length); i++) {
              const da = A[i] || 0,
                db = B[i] || 0;
              if (da > db) return true;
              if (da < db) return false;
            }
            return false;
          })(latest, current);

          if (isNewer) {
            hasShownUpdateDialog = true;
            showStartupDialog(mainWindow, latest);
          } else {
            log.info(
              `APP UP TO DATE after login (current=${current}, latest=${latest})`
            );
          }
        } else {
          log.warn("getUpdateVersion returned null/invalid after login.");
        }
      }
    } catch (e) {
      log.error("Post-login update check failed:", e);
    }

    return { success: true, userInfo: result.userInfo };
  } catch (error) {
    log.error("IPC: Google authentication failed:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("google-logout", async () => {
  log.info("IPC: Google logout requested.");
  try {
    if (googleAuthManager) {
      await googleAuthManager.logout();
      return { success: true };
    }
    return { success: false, error: "Auth manager not initialized." };
  } catch (error) {
    log.error("IPC: Google logout failed:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("fetch-account-list-heureka", async () => {
  log.info("IPC: React UI requested account list fetch.");
  if (accountList !== null) {
    log.info("Returning cached account list.");
    return accountList;
  }
  try {
    const fetchedList = await fetchAccountListHeureka();
    accountList = fetchedList || [];
    return accountList;
  } catch (error) {
    log.error("IPC: Failed to fetch account list:", error);
    accountList = [];
    throw error;
  }
});

ipcMain.handle("show-main-layout", () => {
  log.info("IPC: React UI requested main layout.");
  if (!isMainLayoutActive) {
    isMainLayoutActive = true;
    updateMainLayout();
  }
  return { success: true };
});

ipcMain.handle("refresh-active-tab", async (_event, tabId) => {
  if (!tabId) {
    log.warn("IPC: Refresh requested for null accountId.");
    return { success: false, error: "No account ID provided." };
  }
  log.info(`IPC: Request to refresh tab: ${tabId}`);
  const viewInfo = webViews[tabId];
  if (viewInfo && viewInfo.view && !viewInfo.view.webContents.isDestroyed()) {
    try {
      viewInfo.view.webContents.reload();
      log.info(`Tab ${tabId} reloaded successfully.`);
      return { success: true };
    } catch (error) {
      log.error(`Failed to reload tab ${tabId}:`, error);
      return { success: false, error: error.message };
    }
  } else {
    log.warn(`IPC: Cannot refresh non-existent or destroyed view: ${tabId}`);
    return { success: false, error: "View not found or has been destroyed." };
  }
});

// Dynamically update sidebar width (from renderer resizer)
ipcMain.handle("update-sidebar-width", async (_event, width) => {
  const w = Number(width);
  if (Number.isFinite(w)) {
    // clamp to a sane range
    SIDEBAR_WIDTH = Math.max(0, Math.min(800, Math.round(w)));
  }
  updateMainLayout();
  return { success: true, width: SIDEBAR_WIDTH };
});

// Switch visible tab (show/hide WebContentsViews)
ipcMain.handle("switch-tab", async (_event, tabId) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: "Main window not available." };
    }
    if (!tabId) {
      // Hide all native views, keep only React UI
      showView(null);
      return { success: true };
    }
    const info = webViews[tabId];
    if (!info || !info.view || info.view.webContents.isDestroyed()) {
      return { success: false, error: "Account view not found." };
    }
    showView(tabId);
    return { success: true };
  } catch (e) {
    log.error("switch-tab failed:", e);
    return { success: false, error: e.message };
  }
});

// Close and cleanup a tabbed view
ipcMain.handle("close-tab", async (_event, tabId) => {
  try {
    const info = webViews[tabId];
    if (!info) {
      log.warn(`IPC: Tried to close non-existent view: ${tabId}`);
      return { success: false, error: "Account view not found." };
    }
    // Clear any title watcher timer if present
    try {
      if (info.titleTimer) clearTimeout(info.titleTimer);
    } catch (_) {}
    const view = info.view;
    try {
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.contentView.children.includes(view)
      ) {
        mainWindow.contentView.removeChildView(view);
      }
    } catch (e) {
      log.warn(`Error removing view ${tabId}:`, e);
    }
    // Try to destroy the webContents and clear session data
    try {
      view?.webContents?.destroy?.();
    } catch (e) {
      log.warn("destroy webContents failed:", e);
    }
    try {
      await info.session?.clearStorageData?.();
    } catch (e) {
      log.warn("clearStorageData failed:", e);
    }
    try {
      await info.session?.clearCache?.();
    } catch (e) {
      log.warn("clearCache failed:", e);
    }

    delete webViews[tabId];

    if (activeWebViewId === tabId) {
      const openIds = Object.keys(webViews);
      const nextActiveId =
        openIds.length > 0 ? openIds[openIds.length - 1] : null;
      showView(nextActiveId);
      if (reactUiView && !reactUiView.webContents.isDestroyed()) {
        reactUiView.webContents.send("activate-tab", nextActiveId);
      }
    } else {
      updateMainLayout();
    }
    return { success: true };
  } catch (e) {
    log.error("close-tab failed:", e);
    return { success: false, error: e.message };
  }
});

// Reset to initial/home state, removing all native views
ipcMain.handle("reset-to-home", async () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return { success: true };

    // Remove all tabbed webviews
    for (const id of Object.keys(webViews)) {
      const info = webViews[id];
      try {
        if (info?.titleTimer) clearTimeout(info.titleTimer);
      } catch (_) {}
      const view = info?.view;
      try {
        if (view && mainWindow.contentView.children.includes(view)) {
          mainWindow.contentView.removeChildView(view);
        }
      } catch (e) {
        log.warn(`Error removing view ${id}:`, e);
      }
      try {
        view?.webContents?.destroy?.();
      } catch (e) {
        log.warn(`destroy webContents failed for ${id}:`, e);
      }
      try {
        await info.session?.clearStorageData?.();
      } catch (e) {
        log.warn(`clearStorageData failed for ${id}:`, e);
      }
      try {
        await info.session?.clearCache?.();
      } catch (e) {
        log.warn(`clearCache failed for ${id}:`, e);
      }
    }
    webViews = {};
    activeWebViewId = null;

    // Remove legacy full-window Mergado view if present
    if (mergadoView) {
      try {
        if (mainWindow.contentView.children.includes(mergadoView)) {
          mainWindow.contentView.removeChildView(mergadoView);
        }
      } catch (e) {
        log.warn("Error removing mergadoView:", e);
      }
      try {
        mergadoView.webContents?.destroy?.();
      } catch (e) {
        log.warn("destroy mergado webContents failed:", e);
      }
      mergadoView = null;
    }

    // Keep React UI visible and mark we are back on initial
    isMainLayoutActive = false;
    try {
      if (
        reactUiView &&
        !reactUiView.webContents.isDestroyed() &&
        !mainWindow.contentView.children.includes(reactUiView)
      ) {
        mainWindow.contentView.addChildView(reactUiView);
      }
    } catch (e) {
      log.warn("Failed ensuring reactUiView presence on reset:", e);
    }
    updateMainLayout();
    if (reactUiView && !reactUiView.webContents.isDestroyed()) {
      reactUiView.webContents.send("activate-tab", null);
    }
    return { success: true };
  } catch (e) {
    log.error("reset-to-home failed:", e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle("select-account", async (_event, accountInfo) => {
  const accountId = String(accountInfo.id);
  const tabId = String(accountInfo.tabId || accountId);
  const accountName = accountInfo.name;
  const clientCountry = accountInfo?.client_country?.toUpperCase?.() || "CZ";
  const isGroupEmail = !!accountInfo?.tabTitle; // true when the email has multiple accounts (grouped)

  log.info(
    `IPC: Request to open/select account ID: ${accountId} (${accountName}), country: ${clientCountry}`
  );

  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false, error: "Main window closed." };
  }
  if (!isMainLayoutActive) {
    return { success: false, error: "Main layout not active yet." };
  }

  // Hide any other native view while we switch
  showView(null);

  // If this exact tab already exists (replay), just switch
  if (webViews[tabId] && !webViews[tabId].view.webContents.isDestroyed()) {
    log.info(`View for tab ${tabId} exists, switching.`);
    showView(tabId);
    return { success: true, viewAlreadyExists: true, tabId, accountId };
  }

  // Compute target details
  const tldMap = { CZ: "cz", SK: "sk", HU: "hu", RO: "ro", PL: "pl" };
  const tld = tldMap[clientCountry] || "cz";
  const targetUrl = `https://www.heureka.${tld}`;
  const targetDomain = `.heureka.${tld}`;
  const partition = `persist:${tabId}`; // isolate per-tab
  const newSession = session.fromPartition(partition);

  // Create the view now so we can show the loader immediately
  const newView = new WebContentsView({
    webPreferences: {
      session: newSession,
      sandbox: true,
      contextIsolation: false,
      devTools: false,
    },
  });
  const webContents = newView.webContents;
  const sendStatus = (status, error = null) => {
    if (reactUiView && !reactUiView.webContents.isDestroyed()) {
      reactUiView.webContents.send("tab-status-update", {
        tabId,
        accountId,
        status,
        error,
        name: accountName,
        system: "heureka",
      });
    }
  };
  webContents.on(
    "did-start-navigation",
    (event, url, isInPlace, isMainFrame) => {
      if (isMainFrame) sendStatus("loading");
    }
  );
  webContents.on("did-finish-load", () => sendStatus("ready"));
  webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        sendStatus("error", errorDescription || `Error code: ${errorCode}`);
      }
    }
  );

  // Start a poller to pick current label from Heureka header only for grouped-email tabs
  const startOrRestartHeurekaTitleWatcher = () => {
    if (!webViews[tabId]?.isGroupEmail) return;
    try {
      const prev = webViews[tabId]?.titleTimer;
      if (prev) clearTimeout(prev);
    } catch (_) {}
    let lastTitle = null;
    const DEFAULT_TITLE = accountName || "Heureka";
    const POLL_MS = 1000;
    const poll = async () => {
      try {
        if (!newView || newView.webContents.isDestroyed()) return;
        const text = await newView.webContents.executeJavaScript(
          `(() => {
            // Header selected account label (grouped emails)
            const sel = "body > div.cvr-flex.cvr-flex-col.cvr-min-h-full > header > div.cvr-flex.cvr-space-x-12 > button.cvr-flex.cvr-items-center.cvr-space-x-4 > div > span";
            const el = document.querySelector(sel);
            return el ? (el.textContent || '').trim() : '';
          })()`
        );
        const next = text && text.length ? text : DEFAULT_TITLE;
        if (next !== lastTitle) {
          lastTitle = next;
          if (reactUiView && !reactUiView.webContents.isDestroyed()) {
            reactUiView.webContents.send("tab-title-update", {
              tabId,
              title: next,
            });
          }
        }
      } catch (_) {
        // ignore
      } finally {
        if (newView && !newView.webContents.isDestroyed()) {
          const t = setTimeout(poll, POLL_MS);
          if (webViews[tabId]) webViews[tabId].titleTimer = t;
        }
      }
    };
    poll();
  };
  webContents.on("did-finish-load", startOrRestartHeurekaTitleWatcher);
  webContents.on("did-navigate-in-page", startOrRestartHeurekaTitleWatcher);

  // Register in our map and show it below the TabBar
  webViews[tabId] = {
    view: newView,
    session: newSession,
    url: targetUrl,
    name: accountName,
    system: "heureka",
    accountId,
    isGroupEmail,
  };
  showView(tabId);
  updateMainLayout();

  // Let renderer know it's loading
  sendStatus("loading");

  // Load the local full-screen loader immediately
  try {
    const loaderPath = path.join(__dirname, "../renderer/loading.html");
    await newView.webContents.loadFile(loaderPath);
  } catch (e) {
    log.warn(`Could not load local loader for Heureka [${accountId}]:`, e);
  }

  try {
    mergadoView.webContents.openDevTools({ mode: "detach" });
  } catch (e) {
    log.warn("Failed to open DevTools for mergadoView:", e);
  }

  // Now, fetch and apply cookies, then navigate to the target
  try {
    const accountData = await fetchAccountCookies(accountId);
    const rrCookiesObject = accountData?.rr_cookies;

    const toSet = [];
    if (rrCookiesObject && typeof rrCookiesObject === "object") {
      for (const name of Object.keys(rrCookiesObject)) {
        const value = String(rrCookiesObject[name]);
        const httpOnly =
          name === "SESSID_PHP" ||
          name === "__cf_bm" ||
          name.startsWith("hgSCI");
        toSet.push(
          newSession.cookies
            .set({
              url: targetUrl,
              name,
              value,
              domain: targetDomain,
              path: "/",
              secure: true,
              httpOnly,
            })
            .catch((err) =>
              log.error(`[${accountId}] Err setting API cookie '${name}':`, err)
            )
        );
      }
    } else {
      log.warn(`[${accountId}] No rr_cookies found in API response.`);
    }

    for (const name of Object.keys(consentCookies)) {
      const value = String(consentCookies[name]);
      toSet.push(
        newSession.cookies
          .set({
            url: targetUrl,
            name,
            value,
            domain: targetDomain,
            path: "/",
            secure: true,
            httpOnly: false,
          })
          .catch((err) =>
            log.error(
              `[${accountId}] Err setting Consent cookie '${name}':`,
              err
            )
          )
      );
    }

    await Promise.all(toSet);

    log.info(`Loading URL ${targetUrl} for ${accountId}...`);
    await newView.webContents.loadURL(targetUrl);
    log.info(`URL ${targetUrl} loaded for ${accountId}.`);

    return {
      success: true,
      viewAlreadyExists: false,
      tabId,
      accountId,
      name: accountName,
    };
  } catch (error) {
    log.error(`Heureka tab load failed for ${accountId}:`, error);
    sendStatus("error", error.message || String(error));
    return { success: false, error: error.message };
  }
});

ipcMain.handle("fetch-mergado", async () => {
  log.info("IPC: fetch-mergado called. Creating Mergado view.");
  try {
    const targetUrl = "https://app.mergado.com/";
    const targetDomain = ".mergado.com";
    const partition = "persist:mergado";
    const newSession = session.fromPartition(partition);

    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error("Main window is not available to display Mergado view.");
    }

    // Create the view immediately and show a local loader first
    mergadoView = new WebContentsView({
      webPreferences: {
        session: newSession,
        preload: path.join(__dirname, "mergado-preload.js"),
        sandbox: true,
        contextIsolation: true,
        devTools: false,
      },
    });

    // Open DevTools to help inspect selectors in Mergado
    try {
      mergadoView.webContents.openDevTools({ mode: "detach" });
    } catch (e) {
      log.warn("Failed to open DevTools for mergadoView:", e);
    }

    // Do not show the view yet; we'll display it after DOMContentLoaded and removal

    // In parallel, clear the session and fetch cookies
    const clearPromise = Promise.all([
      newSession
        .clearStorageData()
        .catch((e) => log.error("Failed to clear Mergado session storage:", e)),
      newSession
        .clearCache()
        .catch((e) => log.error("Failed to clear Mergado session cache:", e)),
    ]);
    const fetchPromise = fetchMergadoCookies();

    const mergadoData = await fetchPromise;
    if (!mergadoData || !mergadoData.data || !mergadoData.data.rr_cookies) {
      throw new Error("Invalid or missing Mergado cookie data from API.");
    }
    await clearPromise; // ensure the session is cleared before setting cookies

    const rrCookiesObject = mergadoData.data.rr_cookies;
    const allCookiePromises = [];
    if (rrCookiesObject && typeof rrCookiesObject === "object") {
      log.info(
        `Setting ${Object.keys(rrCookiesObject).length} Mergado cookies.`
      );
      for (const name in rrCookiesObject) {
        const value = String(rrCookiesObject[name]);
        const details = {
          url: targetUrl,
          name,
          value,
          domain: targetDomain,
          path: "/",
          secure: true,
          httpOnly: name.toLowerCase().includes("sess"),
        };
        allCookiePromises.push(
          newSession.cookies.set(details).catch((err) => {
            log.error(`[Mergado] Err setting cookie '${name}':`, err);
          })
        );
      }
    }
    await Promise.all(allCookiePromises);

    await mergadoView.webContents.loadURL(targetUrl);
    // Wait for DOMContentLoaded
    await new Promise((resolve) =>
      mergadoView.webContents.once("dom-ready", resolve)
    );
    // Remove the target element reliably (immediate + MutationObserver, 20s timeout)
    const removalSucceeded = await mergadoView.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const selector = "#user-panel > li.dropdown-legacy.dropdown-anchor.user-menu";
        function tryRemove() {
          const el = document.querySelector(selector);
          if (el) {
            if (el.parentElement && typeof el.parentElement.removeChild === 'function') {
              el.parentElement.removeChild(el);
            } else if (typeof el.remove === 'function') {
              el.remove();
            }
            return true;
          }
          return false;
        }
        if (tryRemove()) return resolve(true);
        const obs = new MutationObserver(() => {
          if (tryRemove()) {
            obs.disconnect();
            resolve(true);
          }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => { obs.disconnect(); resolve(false); }, 20000);
      });
    `);
    if (!removalSucceeded) {
      log.warn("Mergado element removal timed out; showing view anyway.");
    }

    // Now show the view
    const [windowWidth, windowHeight] = mainWindow.getContentSize();
    const topY = TAB_BAR_HEIGHT;
    const viewHeight = Math.max(windowHeight - topY, 0);
    mainWindow.contentView.addChildView(mergadoView);
    mergadoView.setBounds({
      x: 0,
      y: topY,
      width: windowWidth,
      height: viewHeight,
    });
    log.info("Mergado view displayed after DOMContentLoaded and cleanup.");

    return { success: true };
  } catch (error) {
    log.error("IPC: fetch-mergado failed:", error);
    // If it fails, make sure we are showing the React UI
    if (reactUiView && !mainWindow.contentView.children.includes(reactUiView)) {
      mainWindow.contentView.addChildView(reactUiView);
    }
    return { success: false, error: error.message };
  }
});

// Open Mergado in the tabbed area (as an account-like tab)
ipcMain.handle("open-mergado-tab", async () => {
  log.info("IPC: open-mergado-tab called.");
  try {
    const targetUrl = "https://app.mergado.com/";
    const targetDomain = ".mergado.com";
    // Create a unique id and session partition per Mergado tab to isolate context
    const uniqueId = `mergado-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const partition = `persist:${uniqueId}`;
    const newSession = session.fromPartition(partition);

    // Create the view right away so we can show the loader instantly
    const newView = new WebContentsView({
      webPreferences: {
        session: newSession,
        sandbox: true,
        contextIsolation: false,
        devTools: false,
      },
    });
    // Open DevTools for the tabbed Mergado view as well
    try {
      newView.webContents.openDevTools({ mode: "detach" });
    } catch (e) {
      log.warn("Failed to open DevTools for Mergado tab view:", e);
    }
    const webContents = newView.webContents;
    const sendStatus = (status, error = null) => {
      if (reactUiView && !reactUiView.webContents.isDestroyed()) {
        reactUiView.webContents.send("tab-status-update", {
          tabId: uniqueId,
          status,
          error,
          name: "Mergado",
          system: "mergado",
        });
      }
    };
    webContents.on(
      "did-start-navigation",
      (event, url, isInPlace, isMainFrame) => {
        if (isMainFrame) sendStatus("loading");
      }
    );
    webContents.on("did-finish-load", () => sendStatus("ready"));
    // Inject removal script after each load to ensure the user menu element is removed
    webContents.on("did-finish-load", async () => {
      try {
        const injectionScript = `
          const selector = "#user-panel > li.dropdown-legacy.dropdown-anchor.user-menu";
          const intervalId = setInterval(() => {
            const targetElement = document.querySelector(selector);
            if (targetElement) {
              clearInterval(intervalId);
              const parent = targetElement.parentElement;
              if (parent && typeof parent.removeChild === 'function') {
                parent.removeChild(targetElement);
              } else if (typeof targetElement.remove === 'function') {
                targetElement.remove();
              }
              console.log('Mergado user menu element removed (tab view).');
            }
          }, 500);
          setTimeout(() => clearInterval(intervalId), 20000);
        `;
        await newView.webContents.executeJavaScript(injectionScript);
      } catch (err) {
        log.warn("Failed to inject removal script into Mergado tab view:", err);
      }
    });
    webContents.on(
      "did-fail-load",
      (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (isMainFrame && errorCode !== -3)
          sendStatus("error", errorDescription || `Error code: ${errorCode}`);
      }
    );

    // Watch breadcrumb span and send dynamic tab title updates
    const startOrRestartTitleWatcher = () => {
      try {
        const prev = webViews[uniqueId]?.titleTimer;
        if (prev) clearTimeout(prev);
      } catch (_) {}
      let lastTitle = null;
      const POLL_MS = 1000;
      const poll = async () => {
        try {
          if (!newView || newView.webContents.isDestroyed()) return;
          const text = await newView.webContents.executeJavaScript(
            `(() => { const el = document.querySelector('#breadcrumb > a > span'); return el ? (el.textContent || '').trim() : ''; })()`
          );
          const next = text && text.length ? text : "Mergado";
          if (next !== lastTitle) {
            lastTitle = next;
            if (reactUiView && !reactUiView.webContents.isDestroyed()) {
              reactUiView.webContents.send("tab-title-update", {
                tabId: uniqueId,
                title: next,
              });
            }
          }
        } catch (_) {
          // ignore
        } finally {
          if (newView && !newView.webContents.isDestroyed()) {
            const t = setTimeout(poll, POLL_MS);
            if (webViews[uniqueId]) webViews[uniqueId].titleTimer = t;
          }
        }
      };
      poll();
    };
    webContents.on("did-finish-load", startOrRestartTitleWatcher);
    webContents.on("did-navigate-in-page", startOrRestartTitleWatcher);
    webContents.on("dom-ready", startOrRestartTitleWatcher);

    webViews[uniqueId] = {
      view: newView,
      session: newSession,
      url: targetUrl,
      name: "Mergado",
      system: "mergado",
    };

    // Show the view and loader immediately
    showView(uniqueId);
    updateMainLayout();
    sendStatus("loading");
    // Show loader right away (no await to avoid delaying the IPC response)
    showLocalLoader(newView.webContents).catch((e) =>
      log.warn("Could not show local loader for Mergado (tabbed):", e)
    );

    // Continue heavy work asynchronously to return early
    (async () => {
      try {
        // Clear session and fetch cookies in parallel
        const clearPromise = Promise.all([
          newSession
            .clearStorageData()
            .catch((e) =>
              log.error("Failed to clear Mergado session storage:", e)
            ),
          newSession
            .clearCache()
            .catch((e) =>
              log.error("Failed to clear Mergado session cache:", e)
            ),
        ]);
        const mergadoData = await fetchMergadoCookies();
        if (!mergadoData || !mergadoData.data || !mergadoData.data.rr_cookies) {
          throw new Error("Invalid or missing Mergado cookie data from API.");
        }
        await clearPromise;

        const rrCookiesObject = mergadoData.data.rr_cookies;
        const allCookiePromises = [];
        for (const name in rrCookiesObject) {
          const value = String(rrCookiesObject[name]);
          const details = {
            url: targetUrl,
            name,
            value,
            domain: targetDomain,
            path: "/",
            secure: true,
            httpOnly: name.toLowerCase().includes("sess"),
          };
          allCookiePromises.push(
            newSession.cookies
              .set(details)
              .catch((err) =>
                log.error(`[MergadoTab] Err setting cookie '${name}':`, err)
              )
          );
        }
        await Promise.all(allCookiePromises);

        await newView.webContents.loadURL(targetUrl);
        sendStatus("ready");
      } catch (err) {
        log.error("Async Mergado tab init failed:", err);
        sendStatus("error", err?.message || String(err));
      }
    })();

    // Return immediately so the UI can add the tab without delay
    return { success: true, id: uniqueId, name: "Mergado" };
  } catch (error) {
    log.error("IPC: open-mergado-tab failed:", error);
    return { success: false, error: error.message };
  }
});

// -----------------------------

// --- Application Lifecycle ---
app.whenReady().then(async () => {
  log.info("App is ready.");
  createWindow().catch((error) => {
    log.error("Unhandled error during createWindow execution:", error);
  });

  // --- Konfigurace Logování ---
  try {
    // nastav přímo electron-log
    log.transports.file.level = "info";
    log.transports.file.resolvePathFn = () =>
      path.join(app.getPath("userData"), "logs/main.log");
    log.info(`--- AM Application starting (PID: ${process.pid}) ---`);
    log.info(`App Path: ${app.getAppPath()}`);
    log.info(`User Data Path: ${app.getPath("userData")}`);
    log.info(`Is Dev: ${is.dev}`);
  } catch (e) {
    console.error("FATAL: Logging setup failed:", e);
  }

  log.initialize({
    spyRendererConsole: true,
    includeFutureSessions: true,
  });
  // ---------------------------
  // Overlay IPC
  ipcMain.handle("overlay-open", () => {
    isOverlayOpen = true;
    updateMainLayout();
    return { success: true };
  });
  ipcMain.handle("overlay-close", () => {
    isOverlayOpen = false;
    updateMainLayout();
    return { success: true };
  });
});

app.on("activate", () => {
  if (mainWindow === null) {
    log.info("App activated, creating window...");
    createWindow().catch((error) => {
      log.error(
        "Unhandled error during createWindow execution on activate:",
        error
      );
    });
  }
});

app.on("window-all-closed", () => {
  log.info("All windows closed.");
  if (process.platform !== "darwin") {
    log.info("Quitting app...");
    app.quit();
  }
});

process.on("unhandledRejection", (reason, promise) => {
  log.error("Unhandled Rejection at:", promise, "reason:", reason);
});
