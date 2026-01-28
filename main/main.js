// --- Imports ---
const {
  app,
  BaseWindow,
  WebContentsView,
  session,
  net,
  ipcMain,
  Menu,
  BrowserWindow,
  powerMonitor,
  clipboard,
  globalShortcut,
} = require("electron");
const path = require("path");
const fs = require("node:fs").promises;
const log = require("electron-log/main");
const API_TOKEN = `advisio_api_2025_secure`;

const { getUpdateVersion } = require("./utils/getUpdateVersion");
const { showStartupDialog } = require("./utils/dialog");

// Disable third-party cookie blocking for Google authentication
app.commandLine.appendSwitch(
  "disable-features",
  "ThirdPartyCookieDeprecationTrial,PartitionedCookies",
);

log.transports.console.level = "silly";

// Preload loader HTML into memory to minimize I/O latency when showing loader
let LOADER_HTML_CACHE = null;
let STARTUP_LOADER_HTML_CACHE = null;

// Simple loader for tabs (original style with small logo)
const SIMPLE_LOADER_HTML = `<!doctype html><html><head><meta charset="utf-8"/><title>Načítání…</title><meta name="viewport" content="width=device-width, initial-scale=1"/><style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#f5f7fb;color:#333;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}.card{display:flex;gap:12px;align-items:center;padding:14px 18px;background:rgba(255,255,255,0.9);box-shadow:0 8px 30px rgba(0,0,0,0.12);backdrop-filter:blur(10px)}.logo{width:20px;height:20px;flex:0 0 auto;filter:grayscale(30%);opacity:.85}.title{font-size:16px;font-weight:600}.dots{display:inline-block}.dots span{display:inline-block;width:4px;height:4px;margin-left:3px;background:#666;opacity:.25;animation:pulse 1.4s infinite ease-in-out}.dots span:nth-child(2){animation-delay:.2s}.dots span:nth-child(3){animation-delay:.4s}@keyframes pulse{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:.9;transform:translateY(-2px)}}</style></head><body><div class="card"><img class="logo" src="./public/img/logos/advisio_logo.svg" alt="Advisio"/><div class="title">Načítání</div><div class="dots"><span></span><span></span><span></span></div></div></body></html>`;

async function ensureStartupLoaderHtml() {
  if (STARTUP_LOADER_HTML_CACHE) return STARTUP_LOADER_HTML_CACHE;
  try {
    const rendererRoot = app.isPackaged
      ? path.join("../dist/renderer")
      : path.join("../renderer");
    const loaderPath = path.join(__dirname, rendererRoot, "loading.html");
    STARTUP_LOADER_HTML_CACHE = await fs.readFile(loaderPath, "utf-8");
    return STARTUP_LOADER_HTML_CACHE;
  } catch (e) {
    log.warn("Failed to read loading.html, falling back to inline loader:", e);
    STARTUP_LOADER_HTML_CACHE = `<!doctype html><html><head><meta charset="utf-8"/><title>Načítání…</title><style>html,body{height:100%;margin:0;background:#20394a}</style></head><body></body></html>`;
    return STARTUP_LOADER_HTML_CACHE;
  }
}

// Startup loader (big Advisio logo) - only for app startup
async function showStartupLoader(webContents) {
  try {
    const html = await ensureStartupLoaderHtml();
    const baseDir = app.isPackaged
      ? path.join(__dirname, "../dist/renderer/")
      : path.join(__dirname, "../renderer/");
    const baseUrl = `file://${baseDir}`;
    await webContents.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
      { baseURLForDataURL: baseUrl },
    );
  } catch (e) {
    log.warn("showStartupLoader failed, fallback to loadFile:", e);
    try {
      const rendererRoot = app.isPackaged
        ? path.join("../dist/renderer")
        : path.join("../renderer");
      const loaderPath = path.join(__dirname, rendererRoot, "loading.html");
      await webContents.loadFile(loaderPath);
    } catch (err) {
      log.error("Fallback startup loader loadFile also failed:", err);
    }
  }
}

// Simple loader for tabs
async function showLocalLoader(webContents) {
  try {
    const baseDir = app.isPackaged
      ? path.join(__dirname, "../dist/renderer/")
      : path.join(__dirname, "../renderer/");
    const baseUrl = `file://${baseDir}`;
    await webContents.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(SIMPLE_LOADER_HTML)}`,
      { baseURLForDataURL: baseUrl },
    );
  } catch (e) {
    log.warn("showLocalLoader failed:", e);
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
// Detached tabs managed in their own BrowserWindows
let detachedTabs = {}; // { [tabId]: { win: BaseWindow, view: WebContentsView, session, name, system, accountId, isGroupEmail, titleTimer?, _hovering?: boolean, _dropTimer?: NodeJS.Timeout, _reattached?: boolean } }
let accountList = null; // Seznam účtů, načte se až na vyžádání
let SIDEBAR_WIDTH = 250;
let TAB_BAR_HEIGHT = 40;
let isMainLayoutActive = false; // Začínáme s úvodní obrazovkou
let googleAuthManager = null; // Google OAuth manager
let hasShownUpdateDialog = false;
let isOverlayOpen = false; // when true, hide native web views so React modals are visible

// Track which webContents have found-in-page listeners to avoid duplicates
const foundInPageListeners = new WeakSet();

// Track which webContents have keyboard shortcut listeners
const keyboardShortcutListeners = new WeakSet();

// Helper to attach keyboard shortcut listener to a webContents
// This captures shortcuts when focus is on the webview (not React UI)
function attachKeyboardShortcutListener(wc) {
  if (!wc || keyboardShortcutListeners.has(wc)) return;
  keyboardShortcutListeners.add(wc);
  log.info("[Keyboard] Attaching keyboard shortcut listener to webContents");

  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;

    const isMac = process.platform === "darwin";
    const modifier = isMac ? input.meta : input.control;

    // Log all key presses with modifier for debugging (including arrow keys)
    if (modifier || input.alt || input.key.includes("Arrow")) {
      log.info(
        `[Shortcut] Key: ${input.key}, code: ${input.code}, modifier: ${modifier}, alt: ${input.alt}, shift: ${input.shift}`,
      );
    }

    // Forward keyboard shortcuts to React UI
    const reactUiAvailable =
      reactUiView && !reactUiView.webContents.isDestroyed();
    if (!reactUiAvailable && (modifier || input.alt)) {
      log.warn("[Shortcut] ReactUI view not available!");
    }

    if (reactUiAvailable) {
      // Cmd/Ctrl+F - Find in page
      if (modifier && input.key.toLowerCase() === "f") {
        event.preventDefault();
        log.info("[Shortcut] Sending 'find' action to React UI");
        reactUiView.webContents.send("keyboard-shortcut", { action: "find" });
        // Focus reactUiView so the search input can receive focus
        reactUiView.webContents.focus();
        return;
      }

      // Cmd/Ctrl+R - Refresh
      if (modifier && input.key.toLowerCase() === "r") {
        event.preventDefault();
        log.info("[Shortcut] Sending 'refresh' action to React UI");
        reactUiView.webContents.send("keyboard-shortcut", {
          action: "refresh",
        });
        return;
      }

      // Cmd/Ctrl+Backspace - Go back
      if (modifier && input.key === "Backspace") {
        event.preventDefault();
        log.info("[Shortcut] Sending 'back' action to React UI");
        reactUiView.webContents.send("keyboard-shortcut", { action: "back" });
        return;
      }

      // Cmd/Ctrl+Shift+C - Copy URL
      if (modifier && input.shift && input.key.toLowerCase() === "c") {
        event.preventDefault();
        log.info("[Shortcut] Sending 'copyUrl' action to React UI");
        reactUiView.webContents.send("keyboard-shortcut", {
          action: "copyUrl",
        });
        return;
      }

      // Cmd/Ctrl+T - New tab
      if (modifier && input.key.toLowerCase() === "t") {
        event.preventDefault();
        log.info("[Shortcut] Sending 'newTab' action to React UI");
        reactUiView.webContents.send("keyboard-shortcut", { action: "newTab" });
        // Focus reactUiView so the modal can receive keyboard events
        reactUiView.webContents.focus();
        return;
      }

      // Alt/Option+H - Go home (use code instead of key for Mac compatibility)
      if (
        input.alt &&
        (input.key.toLowerCase() === "h" || input.code === "KeyH")
      ) {
        event.preventDefault();
        log.info("[Shortcut] Sending 'home' action to React UI");
        reactUiView.webContents.send("keyboard-shortcut", { action: "home" });
        return;
      }

      // Cmd+Shift+[ (BracketLeft) or Ctrl+Shift+Tab or Cmd/Ctrl+Left - Previous tab
      if (
        (modifier &&
          input.shift &&
          (input.key === "[" || input.code === "BracketLeft")) ||
        (input.control && input.shift && input.key === "Tab") ||
        (modifier && input.key === "ArrowLeft")
      ) {
        event.preventDefault();
        log.info(
          "[Shortcut] Sending 'prevTab' action to React UI via before-input-event",
        );
        reactUiView.webContents.send("keyboard-shortcut", {
          action: "prevTab",
        });
        return;
      }

      // Cmd+Shift+] (BracketRight) or Ctrl+Tab or Cmd/Ctrl+Right - Next tab
      if (
        (modifier &&
          input.shift &&
          (input.key === "]" || input.code === "BracketRight")) ||
        (input.control && !input.shift && input.key === "Tab") ||
        (modifier && input.key === "ArrowRight")
      ) {
        event.preventDefault();
        log.info(
          "[Shortcut] Sending 'nextTab' action to React UI via before-input-event",
        );
        reactUiView.webContents.send("keyboard-shortcut", {
          action: "nextTab",
        });
        return;
      }

      // Escape - Close find bar (when find is open)
      if (input.key === "Escape") {
        log.info("[Shortcut] Sending 'closeFindBar' action to React UI");
        reactUiView.webContents.send("keyboard-shortcut", {
          action: "closeFindBar",
        });
        return;
      }
    }
  });
}

// Helper to attach found-in-page listener to a webContents
function attachFoundInPageListener(wc, tabId) {
  if (!wc || foundInPageListeners.has(wc)) return;
  foundInPageListeners.add(wc);
  wc.on("found-in-page", (_event, result) => {
    try {
      // Send to main React UI
      if (reactUiView && !reactUiView.webContents.isDestroyed()) {
        reactUiView.webContents.send("find-in-page-result", {
          tabId,
          activeMatchOrdinal: result.activeMatchOrdinal,
          matches: result.matches,
          finalUpdate: result.finalUpdate,
        });
      }
      // Also send to detached UI if this tab is detached
      const detached = detachedTabs[tabId];
      if (detached?.ui && !detached.ui.webContents.isDestroyed()) {
        detached.ui.webContents.send("find-in-page-result", {
          tabId,
          activeMatchOrdinal: result.activeMatchOrdinal,
          matches: result.matches,
          finalUpdate: result.finalUpdate,
        });
      }
    } catch (e) {
      log.warn("Error sending find-in-page result:", e);
    }
  });
}

// --- Activity-driven OAuth refresh (shared for all windows) ---
const MIN_REFRESH_INTERVAL_MS = 10 * 1000; // avoid hammering Google
let lastOAuthRefreshAt = 0;
let logoutInProgress = false;
let resettingHomeInProgress = false;

function notifyAuthExpired(reason) {
  try {
    if (reactUiView && !reactUiView.webContents.isDestroyed()) {
      reactUiView.webContents.send("auth-expired", { reason });
    }
  } catch (e) {
    log.warn("Failed to notify renderer about auth expiration:", e);
  }
}

function closeAllDetachedWindows() {
  try {
    const ids = Object.keys(detachedTabs || {});
    for (const id of ids) {
      const rec = detachedTabs[id];
      try {
        if (rec?.win && !rec.win.isDestroyed()) {
          rec.win.close();
        }
      } catch (e) {
        log.warn(`Failed to close detached window ${id}:`, e);
      }
    }
  } catch (e) {
    log.warn("closeAllDetachedWindows failed:", e);
  }
}

async function resetToHomeInternal() {
  if (resettingHomeInProgress) return { success: true };
  resettingHomeInProgress = true;
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
    log.error("resetToHomeInternal failed:", e);
    return { success: false, error: e.message };
  } finally {
    resettingHomeInProgress = false;
  }
}

function ensureGoogleAuthManager() {
  try {
    if (!googleAuthManager && GoogleAuthManager) {
      googleAuthManager = new GoogleAuthManager();
    }
  } catch (e) {
    log.error("Failed to initialize GoogleAuthManager:", e);
  }
  return googleAuthManager;
}

async function triggerAuthRefresh(reason) {
  try {
    const now = Date.now();
    if (now - lastOAuthRefreshAt < MIN_REFRESH_INTERVAL_MS) {
      log.debug(`auth-refresh skipped due to cooldown (${reason})`);
      return;
    }
    lastOAuthRefreshAt = now;

    const mgr = ensureGoogleAuthManager();
    if (!mgr || !mgr.credentials) {
      console.warn("auth-refresh: credentials not available, skipping");
      return;
    }
    const creds = mgr.credentials;
    const refreshToken = mgr.tokens?.refresh_token;
    if (!refreshToken) {
      console.warn(
        "auth-refresh: no refresh_token available -> logout & show login",
      );
      if (!logoutInProgress) {
        logoutInProgress = true;
        try {
          await mgr.logout();
          closeAllDetachedWindows();
          await resetToHomeInternal();
        } catch (e) {
          log.warn("Logout failed when no refresh token:", e);
        } finally {
          logoutInProgress = false;
        }
      }
      notifyAuthExpired("no-refresh-token");
      return;
    }

    const params = new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    console.log(`[auth-refresh] POST ${creds.token_uri} (${reason})`);
    const res = await net.fetch(creds.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (res.ok) {
      console.log(
        `[auth-refresh] OK ${res.status} ${res.statusText} (${reason})`,
      );
    } else {
      const errBody = await res.text().catch(() => "");
      console.error(
        `[auth-refresh] FAIL ${res.status} ${res.statusText} (${reason})`,
        errBody.slice(0, 200) + (errBody.length > 200 ? "…" : ""),
      );
      // Non-200 -> logout user per requirement
      if (!logoutInProgress) {
        logoutInProgress = true;
        try {
          await mgr.logout();
          console.log("[auth-refresh] User logged out due to failed refresh.");
          closeAllDetachedWindows();
          await resetToHomeInternal();
        } catch (e) {
          console.error("[auth-refresh] Logout failed:", e);
        } finally {
          logoutInProgress = false;
        }
      }
      notifyAuthExpired("refresh-failed");
    }
  } catch (e) {
    console.error(`[auth-refresh] failed (${reason}):`, e);
    notifyAuthExpired("refresh-error");
    // Best-effort close detached windows on unexpected errors too
    closeAllDetachedWindows();
    await resetToHomeInternal();
    // NOTE: logout on errors handled above is adequate; keeping here minimal to avoid double logout
  }
}

function attachWindowActivityListeners(win) {
  if (!win || win.isDestroyed()) return;
  if (win.__authListenersAttached) return;
  win.__authListenersAttached = true;
  try {
    win.on("focus", () => {
      log.warn("focus");
      triggerAuthRefresh("focus");
    });
    win.on("blur", () => {
      log.warn("blur");
      triggerAuthRefresh("blur");
    });
  } catch (e) {
    log.warn("attachWindowActivityListeners failed:", e);
  }
}

app.on("browser-window-created", (_e, win) => {
  attachWindowActivityListeners(win);
});
// Also attach app-level focus/blur for reliability across all windows
app.on("browser-window-focus", () => {
  log.warn("focus");
  triggerAuthRefresh("focus");
});
app.on("browser-window-blur", () => {
  log.warn("blur");
  triggerAuthRefresh("blur");
});
// ---------------------------------------------------------------

// Helper: broadcast a tab-related event to all relevant UIs (main React UI and detached window UI if present)
function broadcastTabUi(tabId, channel, payload) {
  try {
    if (reactUiView && !reactUiView.webContents.isDestroyed()) {
      reactUiView.webContents.send(channel, payload);
    }
  } catch (e) {
    log.warn(`Failed sending ${channel} to main UI:`, e);
  }
  try {
    const rec = detachedTabs?.[tabId];
    const uiWc = rec?.ui?.webContents;
    if (uiWc && !uiWc.isDestroyed()) {
      uiWc.send(channel, payload);
    }
  } catch (e) {
    log.warn(`Failed sending ${channel} to detached UI for ${tabId}:`, e);
  }
}

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
            `Account list fetch failed with status: ${response.statusCode}`,
          ),
        );
      }
      let body = "";
      response.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      response.on("end", () => {
        log.info("API account list response finished.");
        log.debug("Raw account list response body:", body);
        try {
          const jsonData = JSON.parse(body);
          if (Array.isArray(jsonData)) {
            log.info(
              `Successfully parsed ${jsonData.length} accounts from JSON.`,
            );
            resolve(jsonData);
          } else {
            log.error(
              "Parsed account list response is not an array:",
              jsonData,
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
        `API Cookies [${accountId}] Status Code: ${response.statusCode}`,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return reject(
          new Error(
            `Cookie fetch for ${accountId} failed with status: ${response.statusCode}`,
          ),
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
              `API response for ${accountId} cookies was not a valid object.`,
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
        `HTTP ${res.status} ${res.statusText}: ${errBody.slice(0, 200)}…`,
      );
    }

    // TADY je ten rozdíl: parsuj tělo, ne res samotný
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchGoogleCredentials(email) {
  const maskToken = (token) => {
    const s = String(token || "");
    if (s.length <= 8) return "***";
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  };

  const emailToUse = String(email || "").trim() || "ppc@advisio.cz";

  const requestJson = ({ label, method, url, headers, body }) =>
    new Promise((resolve, reject) => {
      const safeUrl = url.includes(API_TOKEN)
        ? url.replaceAll(API_TOKEN, maskToken(API_TOKEN))
        : url;
      console.log(
        `[Google credentials] Attempt: ${label} ${method} ${safeUrl}`,
      );

      const request = net.request({ method, url, timeout: 15000 });

      if (headers && typeof headers === "object") {
        for (const [k, v] of Object.entries(headers)) {
          try {
            request.setHeader(k, v);
          } catch (_) {
            // ignore
          }
        }
      }

      request.on("response", (response) => {
        let raw = "";
        response.on("data", (chunk) => {
          raw += chunk.toString("utf8");
        });
        response.on("end", () => {
          const status = response.statusCode || 0;
          const ok = status >= 200 && status < 300;
          console.log(
            `[Google credentials] ${label} -> HTTP ${status} (ok=${ok}) bodyLen=${raw.length}`,
          );
          if (!ok) {
            return reject(
              Object.assign(
                new Error(
                  `[${label}] HTTP ${status}: ${raw
                    .slice(0, 800)
                    .replace(/\s+/g, " ")
                    .trim()}`,
                ),
                {
                  _debugAttempt: {
                    label,
                    method,
                    url: safeUrl,
                    status,
                    ok,
                    bodySnippet: raw.slice(0, 800).replace(/\s+/g, " ").trim(),
                  },
                },
              ),
            );
          }

          try {
            const parsed = raw ? JSON.parse(raw) : null;
            resolve({
              parsed,
              raw,
              _debugAttempt: { label, method, url: safeUrl, status, ok },
            });
          } catch {
            resolve({
              parsed: raw,
              raw,
              _debugAttempt: { label, method, url: safeUrl, status, ok },
            });
          }
        });
      });

      request.on("error", (e) => {
        console.log(
          `[Google credentials] ${label} error: ${e?.message || String(e)}`,
        );
        reject(
          Object.assign(new Error(e?.message || String(e)), {
            _debugAttempt: {
              label,
              method,
              url: safeUrl,
              status: null,
              ok: false,
              error: e?.message || String(e),
            },
          }),
        );
      });

      if (body != null) {
        try {
          request.write(body);
        } catch (_) {
          // ignore
        }
      }
      request.end();
    });

  const endpointsToTry = [
    {
      label: "GET json body",
      method: "GET",
      url: "https://app.advisio.cz/api/credentials/google/",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ api_token: API_TOKEN, email: emailToUse }),
    },
  ];

  const debugAttempts = [];
  let lastError = null;
  for (const ep of endpointsToTry) {
    try {
      const res = await requestJson(ep);
      if (res?._debugAttempt) debugAttempts.push(res._debugAttempt);
      return { data: res.parsed, debugAttempts };
    } catch (e) {
      lastError = e;
      if (e?._debugAttempt) debugAttempts.push(e._debugAttempt);
    }
  }

  const enriched = new Error(
    lastError?.message || "Unknown error while fetching credentials",
  );
  enriched.debugAttempts = debugAttempts;
  throw enriched;
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
          // Heureka záložky mají místo pro sidebar, Mergado a Google mají být full width
          const isFullWidth =
            wvInfo.system === "mergado" || wvInfo.system === "google";
          const leftX = isFullWidth ? 0 : Math.max(SIDEBAR_WIDTH || 0, 0);
          const topY = TAB_BAR_HEIGHT;
          const viewWidth = isFullWidth ? windowWidth : windowWidth - leftX;
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

/** Compute if a rectangle contains a point */
function rectContainsPoint(rect, pt) {
  return (
    pt.x >= rect.x &&
    pt.x <= rect.x + rect.width &&
    pt.y >= rect.y &&
    pt.y <= rect.y + rect.height
  );
}

/** Update hover highlight state and schedule drop-based reattach when hovering over tab bar */
function maybeHandleDetachedMove(tabId) {
  try {
    const rec = detachedTabs[tabId];
    if (!rec || !mainWindow || mainWindow.isDestroyed()) return;
    const win = rec.win;
    if (!win || win.isDestroyed()) return;

    // Tab bar area in screen coords (content bounds top strip of height TAB_BAR_HEIGHT)
    const contentBounds = mainWindow.getContentBounds();
    const tabBarRect = {
      x: contentBounds.x,
      y: contentBounds.y - 6, // allow a small margin
      width: contentBounds.width,
      height: TAB_BAR_HEIGHT + 12, // expand drop zone for easier hover
    };

    // Use top-center of the detached window outer bounds as the drop point
    const b = win.getBounds();
    const dropPoint = { x: b.x + Math.floor(b.width / 2), y: b.y + 10 };
    const hovering = rectContainsPoint(tabBarRect, dropPoint);

    // Hover-to-reattach behavior disabled: no-op (visual indicator removed)
    rec._hovering = false;

    // If not hovering, cancel any pending drop attach
    if (!hovering) {
      if (rec._dropTimer) {
        clearTimeout(rec._dropTimer);
        rec._dropTimer = null;
      }
      return;
    }

    // Reattach is now handled explicitly by dropping on a TabBar via IPC.
  } catch (e) {
    log.error("maybeReattachOnPosition failed:", e);
  }
}

function performReattach(tabId) {
  const rec = detachedTabs[tabId];
  if (!rec || !mainWindow || mainWindow.isDestroyed()) return;
  const { win, view } = rec;
  // remove from detached window if present
  try {
    if (win && !win.isDestroyed() && win.contentView && view) {
      if (win.contentView.children?.includes?.(view)) {
        win.contentView.removeChildView(view);
      }
    }
  } catch (e) {
    log.warn("Removing child view from detached win failed:", e);
  }

  // Mark reattached to prevent cleanup on window close
  rec._reattached = true;

  // Close window (don't destroy the view)
  try {
    if (win && !win.isDestroyed()) win.close();
  } catch (e) {
    log.warn("Closing detached window failed:", e);
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
      "./renderer/public/img/logos/easy-access-logo.ico",
    ),
    show: false,
    autoHideMenuBar: true,
    title: "AM",
    backgroundColor: "#20394a", // Match loader background color (Advisio blue)
  });
  // Maximize the window on startup
  mainWindow.maximize();
  // Ensure focus/blur are attached for the main window immediately
  attachWindowActivityListeners(mainWindow);
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
      // Keep sandbox disabled for the React UI so preload can require modules reliably in prod
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: is.dev,
    },
  });

  // Set background color on the WebContentsView to prevent white flash
  reactUiView.setBackgroundColor("#20394a");

  // focus/blur are added for all windows via app 'browser-window-created'

  powerMonitor.on("suspend", () => {
    console.log("Počítač přechází do spánku");
    triggerAuthRefresh("suspend");
  });

  powerMonitor.on("resume", () => {
    console.log("Počítač se probudil");
    triggerAuthRefresh("resume");
  });

  powerMonitor.on("lock-screen", () => {
    console.log("Obrazovka zamknuta");
    triggerAuthRefresh("lock-screen");
  });

  powerMonitor.on("unlock-screen", () => {
    console.log("Obrazovka odemknuta");
    triggerAuthRefresh("unlock-screen");
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
      // Window is already shown with loader, just update layout
      updateMainLayout();
    }
  });

  // Show startup loader (big Advisio logo) and wait for it to fully render before showing window
  try {
    await showStartupLoader(reactUiView.webContents);
    // Small delay to ensure the loader is painted
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Show window with the loader (splash screen)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  } catch (e) {
    log.warn("Initial startup loader failed:", e);
    // Show window anyway even if loader fails
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  }

  // Minimum splash screen display time (in ms)
  const SPLASH_MIN_DELAY = 2500;
  await new Promise((resolve) => setTimeout(resolve, SPLASH_MIN_DELAY));

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
      error,
    );
    try {
      await reactUiView.webContents.loadURL(
        `data:text/html;charset=utf-8,<h1>Chyba načítání UI</h1><p>Nepodařilo se načíst rozhraní aplikace.</p><pre>${error.message}</pre>`,
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
    if (
      currentView &&
      currentView.webContents &&
      !currentView.webContents.isDestroyed()
    ) {
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

// Copy text to clipboard (works even when focus is on webview)
ipcMain.handle("copy-to-clipboard", async (_event, text) => {
  try {
    clipboard.writeText(text);
    return { success: true };
  } catch (error) {
    log.error("Failed to copy to clipboard:", error);
    return { success: false, error: error.message };
  }
});

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
              `APP UP TO DATE after login (current=${current}, latest=${latest})`,
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
  let viewInfo = webViews[tabId];
  // If not in main map, try detached
  if (!viewInfo && detachedTabs[tabId]) {
    const rec = detachedTabs[tabId];
    viewInfo = { view: rec.view };
  }
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

// Query if a specific tab can navigate back in its history
ipcMain.handle("can-go-back", async (_event, tabId) => {
  try {
    if (!tabId) return { success: false, canGoBack: false, error: "No tabId" };
    let info = webViews[tabId];
    if (!info && detachedTabs[tabId]) {
      const rec = detachedTabs[tabId];
      info = { view: rec.view };
    }
    const wc = info?.view?.webContents;
    const can = !!(wc && !wc.isDestroyed() && wc.canGoBack());
    return { success: true, canGoBack: can };
  } catch (e) {
    log.error("can-go-back failed:", e);
    return { success: false, canGoBack: false, error: e.message };
  }
});

// Get current URL of a specific tab
ipcMain.handle("get-current-tab-url", async (_event, tabId) => {
  try {
    if (!tabId) return { success: false, url: null, error: "No tabId" };
    let info = webViews[tabId];
    if (!info && detachedTabs[tabId]) {
      const rec = detachedTabs[tabId];
      info = { view: rec.view };
    }
    const wc = info?.view?.webContents;
    if (!wc || wc.isDestroyed()) {
      return { success: false, url: null, error: "Tab not found or destroyed" };
    }
    const url = wc.getURL();
    return { success: true, url };
  } catch (e) {
    log.error("get-current-tab-url failed:", e);
    return { success: false, url: null, error: e.message };
  }
});

// Find in page - start searching
ipcMain.handle("find-in-page", async (_event, tabId, text) => {
  try {
    if (!tabId || !text) return { success: false };
    let info = webViews[tabId];
    if (!info && detachedTabs[tabId]) {
      info = { view: detachedTabs[tabId].view };
    }
    const wc = info?.view?.webContents;
    if (!wc || wc.isDestroyed()) return { success: false };
    attachFoundInPageListener(wc, tabId);
    wc.findInPage(text);
    return { success: true };
  } catch (e) {
    log.error("find-in-page failed:", e);
    return { success: false, error: e.message };
  }
});

// Find in page - next match
ipcMain.handle("find-in-page-next", async (_event, tabId, text) => {
  try {
    if (!tabId || !text) return { success: false };
    let info = webViews[tabId];
    if (!info && detachedTabs[tabId]) {
      info = { view: detachedTabs[tabId].view };
    }
    const wc = info?.view?.webContents;
    if (!wc || wc.isDestroyed()) return { success: false };
    wc.findInPage(text, { forward: true, findNext: true });
    return { success: true };
  } catch (e) {
    log.error("find-in-page-next failed:", e);
    return { success: false, error: e.message };
  }
});

// Find in page - previous match
ipcMain.handle("find-in-page-previous", async (_event, tabId, text) => {
  try {
    if (!tabId || !text) return { success: false };
    let info = webViews[tabId];
    if (!info && detachedTabs[tabId]) {
      info = { view: detachedTabs[tabId].view };
    }
    const wc = info?.view?.webContents;
    if (!wc || wc.isDestroyed()) return { success: false };
    wc.findInPage(text, { forward: false, findNext: true });
    return { success: true };
  } catch (e) {
    log.error("find-in-page-previous failed:", e);
    return { success: false, error: e.message };
  }
});

// Find in page - stop and clear
ipcMain.handle("stop-find-in-page", async (_event, tabId) => {
  try {
    if (!tabId) return { success: false };
    let info = webViews[tabId];
    if (!info && detachedTabs[tabId]) {
      info = { view: detachedTabs[tabId].view };
    }
    const wc = info?.view?.webContents;
    if (!wc || wc.isDestroyed()) return { success: false };
    wc.stopFindInPage("clearSelection");
    return { success: true };
  } catch (e) {
    log.error("stop-find-in-page failed:", e);
    return { success: false, error: e.message };
  }
});

// Navigate back in the specified tab if possible
ipcMain.handle("go-back", async (_event, tabId) => {
  try {
    if (!tabId) return { success: false, error: "No tabId" };
    let info = webViews[tabId];
    if (!info && detachedTabs[tabId]) {
      const rec = detachedTabs[tabId];
      info = { view: rec.view };
    }
    const wc = info?.view?.webContents;
    if (!wc || wc.isDestroyed()) {
      return { success: false, error: "View not found or destroyed." };
    }
    if (!wc.canGoBack()) {
      return { success: false, error: "No previous page in history." };
    }
    wc.goBack();
    return { success: true };
  } catch (e) {
    log.error("go-back failed:", e);
    return { success: false, error: e.message };
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
    // Focus the webContents so keyboard shortcuts work
    info.view.webContents.focus();
    log.info(`[switch-tab] Focused webContents for ${tabId}`);
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

// Show context menu for a tab with action to detach to a new window
ipcMain.handle("show-tab-context-menu", async (_event, tabId) => {
  try {
    const template = [
      {
        label: "Otevřít v novém okně",
        click: () => {
          detachTab(tabId).catch((e) =>
            log.error("Detach from context menu failed:", e),
          );
        },
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({
      window: mainWindow || undefined,
      callback: () => {},
    });
    return { success: true };
  } catch (e) {
    log.error("show-tab-context-menu failed:", e);
    return { success: false, error: e.message };
  }
});

// Detach a tab into its own window and remove it from the main tab bar
async function detachTab(tabId) {
  const info = webViews[tabId];
  if (!mainWindow || mainWindow.isDestroyed())
    throw new Error("Main window not available.");
  if (
    !info ||
    !info.view ||
    !info.view.webContents ||
    info.view.webContents.isDestroyed()
  )
    throw new Error("Tab view not found.");

  // Fetch current dynamic title from page before detaching
  let currentTitle = info.name;
  try {
    if (info.system === "mergado") {
      const text = await info.view.webContents.executeJavaScript(
        `(() => { const el = document.querySelector('#breadcrumb > a > span'); return el ? (el.textContent || '').trim() : ''; })()`,
      );
      if (text && text.length) currentTitle = text;
    } else if (info.system === "heureka" && info.isGroupEmail) {
      const sel =
        "body > div.cvr-flex.cvr-flex-col.cvr-min-h-full > header > div.cvr-flex.cvr-space-x-12 > button.cvr-flex.cvr-items-center.cvr-space-x-4 > div > span";
      const text = await info.view.webContents.executeJavaScript(
        `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? (el.textContent || '').trim() : ''; })()`,
      );
      if (text && text.length) currentTitle = text;
    } else if (info.system === "google" && info.service) {
      const googleSelectors = {
        analytics:
          "#suite-top-nav > gmp-header > gmp-universal-picker > button > span.mdc-button__label > div.gmp-button-text > span > span",
        ads: "body > div:nth-child(5) > root > div > div > awsm-app-bar > div.app-bar-left._ngcontent-awn-AWSM-0 > mcc-nav-slim > mcc-picker-wrapper > mcc-nav > nav-popup-trigger > div > mcc-nav-breadcrumb > div > div.operating-customer._ngcontent-awn-AWSM-14 > span.name._ngcontent-awn-AWSM-14",
        merchant: "accounts-menu .popup-trigger",
      };
      const googleSel = googleSelectors[info.service];
      if (googleSel) {
        if (info.service === "merchant") {
          const text = await info.view.webContents.executeJavaScript(
            `(() => { const el = document.querySelector(${JSON.stringify(googleSel)}); if (!el) return ''; const ariaLabel = el.getAttribute('aria-label') || ''; const match = ariaLabel.match(/:\\s*([^,]+)/); return match ? match[1].trim() : ''; })()`,
          );
          if (text && text.length) currentTitle = text;
        } else {
          const text = await info.view.webContents.executeJavaScript(
            `(() => { const el = document.querySelector(${JSON.stringify(googleSel)}); return el ? (el.textContent || '').trim() : ''; })()`,
          );
          if (text && text.length) currentTitle = text;
        }
      }
    }
  } catch (e) {
    log.warn("Failed to get current title before detach:", e);
  }

  const view = info.view;
  // Remove from main window view hierarchy
  try {
    if (mainWindow.contentView.children.includes(view)) {
      mainWindow.contentView.removeChildView(view);
    }
  } catch (e) {
    log.warn("Error removing view during detach:", e);
  }

  // Remove from webViews map
  try {
    if (webViews[tabId]?.titleTimer) clearTimeout(webViews[tabId].titleTimer);
  } catch (_) {}
  delete webViews[tabId];

  // Choose next active and show
  const openIds = Object.keys(webViews);
  const nextActiveId = openIds.length > 0 ? openIds[openIds.length - 1] : null;
  showView(nextActiveId);
  if (reactUiView && !reactUiView.webContents.isDestroyed()) {
    reactUiView.webContents.send("activate-tab", nextActiveId);
  }

  // Create the new window to host the detached tab
  // Position it with an offset relative to the main window (x+50, y+50)
  const mainBounds =
    typeof mainWindow?.getBounds === "function"
      ? mainWindow.getBounds()
      : { x: 0, y: 0 };
  const posX = (mainBounds?.x ?? 0) + 50;
  const posY = (mainBounds?.y ?? 0) + 350;
  const win = new BaseWindow({
    width: 1200,
    height: 800,
    x: posX,
    y: posY,
    show: true,
    autoHideMenuBar: true,
    title: currentTitle || info.name || "Tab",
    backgroundColor: "#ffffff",
  });
  // Ensure activity listeners are attached to detached window too
  attachWindowActivityListeners(win);

  // Create UI WebContentsView with TabBar (detached.html)
  const uiView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: is.dev,
    },
  });
  win.contentView.addChildView(uiView);

  // Add the existing WebContentsView (native tab) above the UI and size both
  try {
    win.contentView.addChildView(view);
  } catch (e) {
    log.error("Failed adding view to detached window:", e);
  }
  const sizeDetached = () => {
    try {
      const [w, h] = win.getContentSize();
      // UI fills full area (acts as base), native content sits below the tab bar
      uiView.setBounds({ x: 0, y: 0, width: w, height: h });
      view.setBounds({
        x: 0,
        y: TAB_BAR_HEIGHT,
        width: w,
        height: Math.max(h - TAB_BAR_HEIGHT, 0),
      });
    } catch (e) {
      // ignore
    }
  };
  win.on("resize", sizeDetached);
  // Initial sizing
  sizeDetached();

  // Load the detached TabBar UI
  try {
    const viteDevServerUrl =
      process.env["ELECTRON_RENDERER_URL"] || "http://localhost:5173";
    const detachedPath = path.join(__dirname, "../dist/renderer/detached.html");
    const qs = new URLSearchParams({
      tabId,
      name: String(info.name || "Tab"),
      title: String(currentTitle || info.name || "Tab"),
      system: String(info.system || "heureka"),
      service: String(info.service || ""),
    }).toString();
    if (is.dev) {
      await uiView.webContents.loadURL(
        `${viteDevServerUrl}/detached.html?${qs}`,
      );
    } else {
      await uiView.webContents.loadFile(detachedPath, { search: `?${qs}` });
    }
  } catch (e) {
    log.warn("Failed to load detached UI:", e);
  }

  // After UI is ready, seed it with the current tab meta and title
  try {
    const sendMeta = () => {
      try {
        if (!uiView?.webContents?.isDestroyed?.()) {
          uiView.webContents.send("tab-status-update", {
            tabId,
            status: "ready",
            error: null,
            name: info.name,
            system: info.system,
            service: info.service,
          });
          // Also send the current title immediately
          if (currentTitle && currentTitle.length) {
            uiView.webContents.send("tab-title-update", {
              tabId,
              title: currentTitle,
            });
          }
        }
      } catch (_) {}
    };
    uiView.webContents.on("did-finish-load", () => {
      sendMeta();
      setTimeout(sendMeta, 150);
      setTimeout(sendMeta, 400);
    });
  } catch (e) {
    log.warn("Could not seed detached UI with tab meta:", e);
  }

  // Start title watcher for detached Google tabs
  if (info.system === "google" && info.service) {
    const startDetachedGoogleTitleWatcher = () => {
      try {
        const prev = detachedTabs[tabId]?.titleTimer;
        if (prev) clearTimeout(prev);
      } catch (_) {}
      let lastTitle = null;
      const DEFAULT_TITLE = info.name;
      const POLL_MS = 3000; // Poll every 3 seconds
      const titleSelectors = {
        analytics:
          "#suite-top-nav > gmp-header > gmp-universal-picker > button > span.mdc-button__label > div.gmp-button-text > span > span",
        ads: "body > div:nth-child(5) > root > div > div > awsm-app-bar > div.app-bar-left._ngcontent-awn-AWSM-0 > mcc-nav-slim > mcc-picker-wrapper > mcc-nav > nav-popup-trigger > div > mcc-nav-breadcrumb > div > div.operating-customer._ngcontent-awn-AWSM-14 > span.name._ngcontent-awn-AWSM-14",
        merchant: "accounts-menu .popup-trigger",
      };
      const selector = titleSelectors[info.service];
      if (!selector) return;

      const poll = async () => {
        try {
          if (!view || !view.webContents || view.webContents.isDestroyed())
            return;
          if (!detachedTabs[tabId]) return; // Tab no longer detached
          let text;
          if (info.service === "merchant") {
            text = await view.webContents.executeJavaScript(
              `(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) return '';
                const ariaLabel = el.getAttribute('aria-label') || '';
                const match = ariaLabel.match(/:\\s*([^,]+)/);
                return match ? match[1].trim() : '';
              })()`,
            );
          } else {
            text = await view.webContents.executeJavaScript(
              `(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                return el ? (el.textContent || '').trim() : '';
              })()`,
            );
          }
          const next = text && text.length ? text : DEFAULT_TITLE;
          if (next !== lastTitle) {
            lastTitle = next;
            log.info(
              `[Detached Google TitleWatcher] Title changed for ${info.service}: "${next}"`,
            );
            if (uiView && !uiView.webContents.isDestroyed()) {
              uiView.webContents.send("tab-title-update", {
                tabId,
                title: next,
              });
            }
            // Also update window title
            if (win && !win.isDestroyed()) {
              win.setTitle(next);
            }
          }
        } catch (_) {
          // Ignore polling errors silently
        } finally {
          if (
            view &&
            view.webContents &&
            !view.webContents.isDestroyed() &&
            detachedTabs[tabId]
          ) {
            const t = setTimeout(poll, POLL_MS);
            if (detachedTabs[tabId]) detachedTabs[tabId].titleTimer = t;
          }
        }
      };
      poll();
    };
    view.webContents.on("did-finish-load", startDetachedGoogleTitleWatcher);
    view.webContents.on(
      "did-navigate-in-page",
      startDetachedGoogleTitleWatcher,
    );
    startDetachedGoogleTitleWatcher();
  }

  // Start title watcher for detached Heureka tabs (only grouped email ones)
  if (info.system === "heureka" && info.isGroupEmail) {
    const startDetachedHeurekaTitleWatcher = () => {
      try {
        const prev = detachedTabs[tabId]?.titleTimer;
        if (prev) clearTimeout(prev);
      } catch (_) {}
      let lastTitle = null;
      const DEFAULT_TITLE = info.name || "Heureka";
      const POLL_MS = 1000;
      const selector =
        "body > div.cvr-flex.cvr-flex-col.cvr-min-h-full > header > div.cvr-flex.cvr-space-x-12 > button.cvr-flex.cvr-items-center.cvr-space-x-4 > div > span";

      const poll = async () => {
        try {
          if (!view || !view.webContents || view.webContents.isDestroyed())
            return;
          if (!detachedTabs[tabId]) return;
          const text = await view.webContents.executeJavaScript(
            `(() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              return el ? (el.textContent || '').trim() : '';
            })()`,
          );
          const next = text && text.length ? text : DEFAULT_TITLE;
          if (next !== lastTitle) {
            lastTitle = next;
            if (uiView && !uiView.webContents.isDestroyed()) {
              uiView.webContents.send("tab-title-update", {
                tabId,
                title: next,
              });
            }
            if (win && !win.isDestroyed()) {
              win.setTitle(next);
            }
          }
        } catch (_) {
          // Ignore polling errors
        } finally {
          if (
            view &&
            view.webContents &&
            !view.webContents.isDestroyed() &&
            detachedTabs[tabId]
          ) {
            const t = setTimeout(poll, POLL_MS);
            if (detachedTabs[tabId]) detachedTabs[tabId].titleTimer = t;
          }
        }
      };
      poll();
    };
    view.webContents.on("did-finish-load", startDetachedHeurekaTitleWatcher);
    view.webContents.on(
      "did-navigate-in-page",
      startDetachedHeurekaTitleWatcher,
    );
    startDetachedHeurekaTitleWatcher();
  }

  // Start title watcher for detached Mergado tabs
  if (info.system === "mergado") {
    const startDetachedMergadoTitleWatcher = () => {
      try {
        const prev = detachedTabs[tabId]?.titleTimer;
        if (prev) clearTimeout(prev);
      } catch (_) {}
      let lastTitle = null;
      const DEFAULT_TITLE = "Mergado";
      const POLL_MS = 1000;
      const selector = "#breadcrumb > a > span";

      const poll = async () => {
        try {
          if (!view || !view.webContents || view.webContents.isDestroyed())
            return;
          if (!detachedTabs[tabId]) return;
          const text = await view.webContents.executeJavaScript(
            `(() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              return el ? (el.textContent || '').trim() : '';
            })()`,
          );
          const next = text && text.length ? text : DEFAULT_TITLE;
          if (next !== lastTitle) {
            lastTitle = next;
            if (uiView && !uiView.webContents.isDestroyed()) {
              uiView.webContents.send("tab-title-update", {
                tabId,
                title: next,
              });
            }
            if (win && !win.isDestroyed()) {
              win.setTitle(next);
            }
          }
        } catch (_) {
          // Ignore polling errors
        } finally {
          if (
            view &&
            view.webContents &&
            !view.webContents.isDestroyed() &&
            detachedTabs[tabId]
          ) {
            const t = setTimeout(poll, POLL_MS);
            if (detachedTabs[tabId]) detachedTabs[tabId].titleTimer = t;
          }
        }
      };
      poll();
    };
    view.webContents.on("did-finish-load", startDetachedMergadoTitleWatcher);
    view.webContents.on(
      "did-navigate-in-page",
      startDetachedMergadoTitleWatcher,
    );
    view.webContents.on("dom-ready", startDetachedMergadoTitleWatcher);
    startDetachedMergadoTitleWatcher();
  }

  // Hover-to-reattach disabled; explicit drop on TabBar is the only way.

  // Ensure cleanup on close: destroy view and session data
  win.on("closed", async () => {
    try {
      const rec = detachedTabs[tabId];
      if (rec && rec._dropTimer) clearTimeout(rec._dropTimer);
      if (rec && rec._reattached) {
        // Attach back to main now that the detached window is closed
        try {
          const {
            session: sess,
            name,
            system,
            service,
            accountId,
            isGroupEmail,
            url,
          } = rec;
          webViews[tabId] = {
            view,
            session: sess,
            url: url || undefined,
            name,
            system,
            service,
            accountId,
            isGroupEmail,
          };
          showView(tabId);
          updateMainLayout();
          try {
            const [windowWidth, windowHeight] = mainWindow.getContentSize();
            const isFullWidth = system === "mergado" || system === "google";
            const leftX = isFullWidth ? 0 : Math.max(SIDEBAR_WIDTH || 0, 0);
            const topY = TAB_BAR_HEIGHT;
            const viewWidth = isFullWidth ? windowWidth : windowWidth - leftX;
            const viewHeight = isOverlayOpen
              ? 0
              : Math.max(windowHeight - topY, 0);
            view.setBounds({
              x: leftX,
              y: topY,
              width: viewWidth,
              height: viewHeight,
            });
            view.webContents.focus();
            setTimeout(() => {
              try {
                const [w2, h2] = mainWindow.getContentSize();
                const vx = isFullWidth ? 0 : Math.max(SIDEBAR_WIDTH || 0, 0);
                const vy = TAB_BAR_HEIGHT;
                const vw = isFullWidth ? w2 : w2 - vx;
                const vh = isOverlayOpen ? 0 : Math.max(h2 - vy, 0);
                view.setBounds({ x: vx, y: vy, width: vw, height: vh });
                view.webContents.focus();
              } catch (_) {}
            }, 50);
          } catch (e) {
            log.warn(
              "Explicit sizing/focus after reattach (on close) failed:",
              e,
            );
          }
          // Inform renderer to activate it and then recreate the tab + clear hover
          if (reactUiView && !reactUiView.webContents.isDestroyed()) {
            // Send activate first so renderer can clear any 'detached' flag
            reactUiView.webContents.send("activate-tab", tabId);
            // Then send status so the tab entry can be (re)created
            reactUiView.webContents.send("tab-status-update", {
              tabId,
              accountId,
              status: "ready",
              error: null,
              name,
              system,
              service,
            });
            // Immediately try to send a fresh dynamic title reflecting current page
            try {
              let dynamicTitle = null;
              if (system === "mergado") {
                dynamicTitle = await view.webContents
                  .executeJavaScript(
                    `(() => { const el = document.querySelector('#breadcrumb > a > span'); return el ? (el.textContent || '').trim() : ''; })()`,
                  )
                  .catch(() => null);
                if (dynamicTitle && dynamicTitle.length) {
                  reactUiView.webContents.send("tab-title-update", {
                    tabId,
                    title: dynamicTitle,
                  });
                }
              } else if (system === "heureka" && isGroupEmail) {
                const sel =
                  "body > div.cvr-flex.cvr-flex-col.cvr-min-h-full > header > div.cvr-flex.cvr-space-x-12 > button.cvr-flex.cvr-items-center.cvr-space-x-4 > div > span";
                dynamicTitle = await view.webContents
                  .executeJavaScript(
                    `(() => { const el = document.querySelector(${JSON.stringify(
                      sel,
                    )}); return el ? (el.textContent || '').trim() : ''; })()`,
                  )
                  .catch(() => null);
                if (dynamicTitle && dynamicTitle.length) {
                  reactUiView.webContents.send("tab-title-update", {
                    tabId,
                    title: dynamicTitle,
                  });
                }
              } else if (system === "google" && service) {
                const googleSelectors = {
                  analytics:
                    "#suite-top-nav > gmp-header > gmp-universal-picker > button > span.mdc-button__label > div.gmp-button-text > span > span",
                  ads: "body > div:nth-child(5) > root > div > div > awsm-app-bar > div.app-bar-left._ngcontent-awn-AWSM-0 > mcc-nav-slim > mcc-picker-wrapper > mcc-nav > nav-popup-trigger > div > mcc-nav-breadcrumb > div > div.operating-customer._ngcontent-awn-AWSM-14 > span.name._ngcontent-awn-AWSM-14",
                  merchant: "accounts-menu .popup-trigger",
                };
                const googleSel = googleSelectors[service];
                if (googleSel) {
                  if (service === "merchant") {
                    dynamicTitle = await view.webContents
                      .executeJavaScript(
                        `(() => { const el = document.querySelector(${JSON.stringify(
                          googleSel,
                        )}); if (!el) return ''; const ariaLabel = el.getAttribute('aria-label') || ''; const match = ariaLabel.match(/:\\s*([^,]+)/); return match ? match[1].trim() : ''; })()`,
                      )
                      .catch(() => null);
                  } else {
                    dynamicTitle = await view.webContents
                      .executeJavaScript(
                        `(() => { const el = document.querySelector(${JSON.stringify(
                          googleSel,
                        )}); return el ? (el.textContent || '').trim() : ''; })()`,
                      )
                      .catch(() => null);
                  }
                  if (dynamicTitle && dynamicTitle.length) {
                    reactUiView.webContents.send("tab-title-update", {
                      tabId,
                      title: dynamicTitle,
                    });
                  }
                }
              }
            } catch (e) {
              log.warn("Failed to send dynamic title on reattach:", e);
            }
            // No hover UI to clear anymore
          }
        } catch (e) {
          log.error("Attach back on close failed:", e);
        } finally {
          try {
            delete detachedTabs[tabId];
          } catch (_) {}
        }
        return;
      }
      // Not reattached -> destroy resources
      try {
        view?.webContents?.destroy?.();
      } catch (e) {
        log.warn("destroy webContents (detached) failed:", e);
      }
      try {
        await rec.session?.clearStorageData?.();
      } catch (e) {
        log.warn("clearStorageData (detached) failed:", e);
      }
      try {
        await rec.session?.clearCache?.();
      } catch (e) {
        log.warn("clearCache (detached) failed:", e);
      }
      try {
        delete detachedTabs[tabId];
      } catch (_) {}
    } catch (e) {
      log.error("Detached window closed handler failed:", e);
    }
  });

  // Store into detached map for later reattach
  detachedTabs[tabId] = {
    win,
    ui: uiView,
    view,
    session: info.session,
    url: info.url,
    name: info.name,
    system: info.system,
    service: info.service,
    accountId: info.accountId,
    isGroupEmail: info.isGroupEmail,
    titleTimer: info.titleTimer,
    _hovering: false,
    _dropTimer: null,
    _reattached: false,
  };

  // Notify renderer to remove the tab from the bar
  if (reactUiView && !reactUiView.webContents.isDestroyed()) {
    reactUiView.webContents.send("force-close-tab", tabId);
  }

  return { success: true };
}

// Expose detach via IPC for drag-out gesture from renderer
ipcMain.handle("detach-tab", async (_event, tabId) => {
  try {
    await detachTab(tabId);
    return { success: true };
  } catch (e) {
    log.error("detach-tab failed:", e);
    return { success: false, error: e.message };
  }
});

// Attach a detached tab into the window whose TabBar received the drop (currently supports main window)
ipcMain.handle("attach-detached-tab-here", async (event, payload) => {
  try {
    const { tabId } = payload || {};
    if (!tabId) return { success: false, error: "No tabId" };
    const rec = detachedTabs[tabId];
    if (!rec || !rec.view || !rec.win || rec.view.webContents.isDestroyed()) {
      return { success: false, error: "Tab not detached or destroyed" };
    }
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (!senderWin || senderWin.isDestroyed()) {
      return { success: false, error: "Target window invalid" };
    }

    // If target is main window, insert into main tab strip
    if (mainWindow && senderWin.id === mainWindow.id) {
      const {
        view,
        session: sess,
        name,
        system,
        service,
        accountId,
        isGroupEmail,
        url,
      } = rec;

      // Remove from old window
      try {
        if (rec.win && !rec.win.isDestroyed()) {
          if (rec.win.contentView.children?.includes?.(view)) {
            rec.win.contentView.removeChildView(view);
          }
        }
      } catch (e) {
        log.warn("Remove view from detached win (on attach) failed:", e);
      }

      // Register in main map
      webViews[tabId] = {
        view,
        session: sess,
        url: url || undefined,
        name,
        system,
        service,
        accountId,
        isGroupEmail,
      };
      showView(tabId);
      updateMainLayout();
      try {
        const [windowWidth, windowHeight] = mainWindow.getContentSize();
        const isFullWidth = system === "mergado" || system === "google";
        const leftX = isFullWidth ? 0 : Math.max(SIDEBAR_WIDTH || 0, 0);
        const topY = TAB_BAR_HEIGHT;
        const viewWidth = isFullWidth ? windowWidth : windowWidth - leftX;
        const viewHeight = isOverlayOpen ? 0 : Math.max(windowHeight - topY, 0);
        view.setBounds({
          x: leftX,
          y: topY,
          width: viewWidth,
          height: viewHeight,
        });
        view.webContents.focus();
        // Delayed re-layout to ensure proper sizing after attach
        setTimeout(() => {
          try {
            const [w2, h2] = mainWindow.getContentSize();
            const vx = isFullWidth ? 0 : Math.max(SIDEBAR_WIDTH || 0, 0);
            const vy = TAB_BAR_HEIGHT;
            const vw = isFullWidth ? w2 : w2 - vx;
            const vh = isOverlayOpen ? 0 : Math.max(h2 - vy, 0);
            view.setBounds({ x: vx, y: vy, width: vw, height: vh });
            view.webContents.focus();
          } catch (_) {}
        }, 50);
      } catch (_) {}

      // Notify UIs: add/activate the tab and broadcast status/title
      try {
        if (reactUiView && !reactUiView.webContents.isDestroyed()) {
          reactUiView.webContents.send("activate-tab", tabId);
        }
        broadcastTabUi(tabId, "tab-status-update", {
          tabId,
          accountId,
          status: "ready",
          error: null,
          name,
          system,
          service,
        });
        // Try to send a fresh dynamic title
        try {
          let dynamicTitle = null;
          if (system === "mergado") {
            dynamicTitle = await view.webContents
              .executeJavaScript(
                `(() => { const el = document.querySelector('#breadcrumb > a > span'); return el ? (el.textContent || '').trim() : ''; })()`,
              )
              .catch(() => null);
          } else if (system === "heureka" && isGroupEmail) {
            const sel =
              "body > div.cvr-flex.cvr-flex-col.cvr-min-h-full > header > div.cvr-flex.cvr-space-x-12 > button.cvr-flex.cvr-items-center.cvr-space-x-4 > div > span";
            dynamicTitle = await view.webContents
              .executeJavaScript(
                `(() => { const el = document.querySelector(${JSON.stringify(
                  sel,
                )}); return el ? (el.textContent || '').trim() : ''; })()`,
              )
              .catch(() => null);
          } else if (system === "google" && service) {
            const googleSelectors = {
              analytics:
                "#suite-top-nav > gmp-header > gmp-universal-picker > button > span.mdc-button__label > div.gmp-button-text > span > span",
              ads: "body > div:nth-child(5) > root > div > div > awsm-app-bar > div.app-bar-left._ngcontent-awn-AWSM-0 > mcc-nav-slim > mcc-picker-wrapper > mcc-nav > nav-popup-trigger > div > mcc-nav-breadcrumb > div > div.operating-customer._ngcontent-awn-AWSM-14 > span.name._ngcontent-awn-AWSM-14",
              merchant:
                "body > div:nth-child(2) > root > app-bar > div > div.no-print.account-picker-container._ngcontent-bxj-6 > accounts-menu > div > div.popup-trigger._ngcontent-bxj-7",
            };
            const googleSel = googleSelectors[service];
            if (googleSel) {
              if (service === "merchant") {
                dynamicTitle = await view.webContents
                  .executeJavaScript(
                    `(() => { const el = document.querySelector(${JSON.stringify(
                      googleSel,
                    )}); if (!el) return ''; const ariaLabel = el.getAttribute('aria-label') || ''; const match = ariaLabel.match(/:\\s*([^,]+)/); return match ? match[1].trim() : ''; })()`,
                  )
                  .catch(() => null);
              } else {
                dynamicTitle = await view.webContents
                  .executeJavaScript(
                    `(() => { const el = document.querySelector(${JSON.stringify(
                      googleSel,
                    )}); return el ? (el.textContent || '').trim() : ''; })()`,
                  )
                  .catch(() => null);
              }
            }
          }
          if (dynamicTitle && dynamicTitle.length) {
            broadcastTabUi(tabId, "tab-title-update", {
              tabId,
              title: dynamicTitle,
            });
          }
        } catch (_) {}
      } catch (e) {
        log.warn("Failed to notify main UI after attach:", e);
      }

      // Close the detached window without destroying the view (already moved)
      try {
        rec._reattached = true;
        if (rec.win && !rec.win.isDestroyed()) rec.win.close();
      } catch (e) {
        log.warn("Closing detached window after attach failed:", e);
      }

      try {
        delete detachedTabs[tabId];
      } catch (_) {}
      return { success: true };
    }

    return {
      success: false,
      error: "Attach to non-main window not implemented yet",
    };
  } catch (e) {
    log.error("attach-detached-tab-here failed:", e);
    return { success: false, error: e.message };
  }
});

// Reset to initial/home state, removing all native views
ipcMain.handle("reset-to-home", async () => {
  return await resetToHomeInternal();
});

ipcMain.handle("select-account", async (_event, accountInfo) => {
  const accountId = String(accountInfo.id);
  const tabId = String(accountInfo.tabId || accountId);
  const accountName = accountInfo.name;
  const clientCountry = accountInfo?.client_country?.toUpperCase?.() || "CZ";
  const isGroupEmail = !!accountInfo?.tabTitle; // true when the email has multiple accounts (grouped)

  log.info(
    `IPC: Request to open/select account ID: ${accountId} (${accountName}), country: ${clientCountry}`,
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

  // Attach keyboard shortcut listener for this webContents
  attachKeyboardShortcutListener(webContents);

  const sendStatus = (status, error = null) => {
    broadcastTabUi(tabId, "tab-status-update", {
      tabId,
      accountId,
      status,
      error,
      name: accountName,
      system: "heureka",
    });
  };
  webContents.on(
    "did-start-navigation",
    (event, url, isInPlace, isMainFrame) => {
      if (isMainFrame) sendStatus("loading");
    },
  );
  webContents.on("did-finish-load", () => sendStatus("ready"));
  webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        sendStatus("error", errorDescription || `Error code: ${errorCode}`);
      }
    },
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
        if (
          !newView ||
          !newView.webContents ||
          newView.webContents.isDestroyed()
        )
          return;
        const text = await newView.webContents.executeJavaScript(
          `(() => {
            // Header selected account label (grouped emails)
            const sel = "body > div.cvr-flex.cvr-flex-col.cvr-min-h-full > header > div.cvr-flex.cvr-space-x-12 > button.cvr-flex.cvr-items-center.cvr-space-x-4 > div > span";
            const el = document.querySelector(sel);
            return el ? (el.textContent || '').trim() : '';
          })()`,
        );
        const next = text && text.length ? text : DEFAULT_TITLE;
        if (next !== lastTitle) {
          lastTitle = next;
          broadcastTabUi(tabId, "tab-title-update", { tabId, title: next });
        }
      } catch (_) {
        // ignore
        // Network or other error -> logout user per requirement
        try {
          if (!logoutInProgress) {
            logoutInProgress = true;
            await ensureGoogleAuthManager()?.logout();
            console.log("[auth-refresh] User logged out due to refresh error.");
          }
        } catch (err) {
          console.error("[auth-refresh] Logout after error failed:", err);
        } finally {
          logoutInProgress = false;
        }
      } finally {
        if (
          newView &&
          newView.webContents &&
          !newView.webContents.isDestroyed()
        ) {
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

  // Load the simple loader immediately
  try {
    await showLocalLoader(newView.webContents);
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
              log.error(
                `[${accountId}] Err setting API cookie '${name}':`,
                err,
              ),
            ),
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
              err,
            ),
          ),
      );
    }

    await Promise.all(toSet);

    log.info(`Loading URL ${targetUrl} for ${accountId}...`);
    await newView.webContents.loadURL(targetUrl);
    // After first real page load, clear history so the initial loader isn't a back target
    try {
      if (typeof newView.webContents.clearHistory === "function") {
        newView.webContents.clearHistory();
      }
    } catch (e) {
      log.warn("clearHistory after initial load failed (Heureka):", e);
    }
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

    // Attach keyboard shortcut listener for this webContents
    attachKeyboardShortcutListener(mergadoView.webContents);

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
        `Setting ${Object.keys(rrCookiesObject).length} Mergado cookies.`,
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
          }),
        );
      }
    }
    await Promise.all(allCookiePromises);

    await mergadoView.webContents.loadURL(targetUrl);
    // Wait for DOMContentLoaded
    await new Promise((resolve) =>
      mergadoView.webContents.once("dom-ready", resolve),
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

    // Clear history so the loader isn't a back target for standalone view either
    try {
      if (typeof mergadoView.webContents.clearHistory === "function") {
        mergadoView.webContents.clearHistory();
      }
    } catch (e) {
      log.warn(
        "clearHistory after initial load failed (Mergado standalone):",
        e,
      );
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

ipcMain.handle("fetch-google-credentials", async (_event, payload) => {
  log.info("IPC: fetch-google-credentials called.");
  try {
    const email = payload?.email;
    const result = await fetchGoogleCredentials(email);
    // User requested output in terminal -> log in main process
    // Use console.log so it shows up even if electron-log routing differs.
    console.log("[Google credentials] Response:", result?.data);
    return { success: true, data: result?.data, debug: result?.debugAttempts };
  } catch (error) {
    log.error("IPC: fetch-google-credentials failed:", error);
    const msg = error?.message || String(error);
    console.log("[Google credentials] Error:", msg);
    return {
      success: false,
      error: msg,
      debug: error?.debugAttempts || null,
    };
  }
});

// Open Google (Analytics/Ads) as a tabbed view with pre-set cookies
ipcMain.handle("open-google-tab", async (_event, payload) => {
  const { service, email, cookies, userAgent } = payload || {};
  log.info(`IPC: open-google-tab called. service=${service}, email=${email}`);

  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error("Main window is not available.");
    }
    // Activate main layout if not already active
    if (!isMainLayoutActive) {
      log.info("open-google-tab: Activating main layout...");
      isMainLayoutActive = true;
      updateMainLayout();
    }

    // Determine target URL based on service
    const serviceUrls = {
      analytics: "https://analytics.google.com/",
      ads: "https://ads.google.com/aw/overview",
      merchant: "https://merchants.google.com/",
    };
    const targetUrl = serviceUrls[service];
    if (!targetUrl) {
      throw new Error(`Unknown Google service: ${service}`);
    }

    const serviceNames = {
      analytics: "Google Analytics",
      ads: "Google Ads",
      merchant: "Google Merchant Center",
    };
    const serviceName = serviceNames[service] || `Google ${service}`;

    // Create unique id and session partition per Google tab
    const uniqueId = `google-${service}-${Date.now()}-${Math.floor(
      Math.random() * 1e6,
    )}`;
    const partition = `persist:${uniqueId}`;
    const newSession = session.fromPartition(partition);

    // Configure session to accept all cookies
    newSession.webRequest.onHeadersReceived((details, callback) => {
      // Remove any cookie blocking headers
      const responseHeaders = { ...details.responseHeaders };
      callback({ responseHeaders });
    });

    // Create the view
    const newView = new WebContentsView({
      webPreferences: {
        session: newSession,
        sandbox: false, // Disable sandbox to allow better cookie handling
        contextIsolation: false,
        devTools: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });

    const webContents = newView.webContents;

    // Attach keyboard shortcut listener for this webContents
    attachKeyboardShortcutListener(webContents);

    const sendStatus = (status, error = null) => {
      broadcastTabUi(uniqueId, "tab-status-update", {
        tabId: uniqueId,
        status,
        error,
        name: serviceName,
        system: "google",
        service,
      });
    };

    webContents.on(
      "did-start-navigation",
      (event, url, isInPlace, isMainFrame) => {
        if (isMainFrame) sendStatus("loading");
      },
    );
    webContents.on("did-finish-load", () => sendStatus("ready"));
    webContents.on(
      "did-fail-load",
      (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (isMainFrame && errorCode !== -3) {
          sendStatus("error", errorDescription || `Error code: ${errorCode}`);
        }
      },
    );

    // Set user agent BEFORE any navigation
    if (userAgent) {
      webContents.setUserAgent(userAgent);
    }

    // Set cookies BEFORE showing any content (important for Google auth)
    log.info(`[Google] Setting cookies before navigation...`);
    if (cookies && typeof cookies === "object") {
      const cookiePromises = [];
      log.info(
        `[Google] Received ${Object.keys(cookies).length} cookies from API`,
      );

      for (const [key, cookieData] of Object.entries(cookies)) {
        // Cookie name can be in cookieData.name or parse from key (format: "COOKIE_domain.com")
        const cookieName = cookieData.name || key.split("_")[0];
        const originalDomain = cookieData.domain || ".google.com";
        const urlDomain = originalDomain.replace(/^\./, "");
        const isSecure = cookieData.secure === true;

        log.info(
          `[Google] Setting cookie: ${cookieName} for domain ${originalDomain}`,
        );

        const details = {
          url: `https://${urlDomain}`,
          name: cookieName,
          value: String(cookieData.value || ""),
          domain: originalDomain,
          path: cookieData.path || "/",
          secure: isSecure,
          httpOnly: !!cookieData.httpOnly,
        };
        if (isSecure) {
          details.sameSite = "no_restriction";
        }
        if (cookieData.expiry) {
          details.expirationDate = cookieData.expiry;
        }

        cookiePromises.push(
          newSession.cookies.set(details).catch((err) => {
            log.error(
              `[Google] Error setting cookie '${cookieName}' for ${originalDomain}:`,
              err.message,
            );
          }),
        );
      }
      await Promise.all(cookiePromises);
      log.info(`[Google] Cookies set successfully`);

      // Log all cookies in session
      const allCookies = await newSession.cookies.get({});
      log.info(`[Google] Session has ${allCookies.length} cookies total`);
      for (const c of allCookies) {
        log.info(`[Google]   - ${c.name} @ ${c.domain}`);
      }
    } else {
      log.warn("No cookies provided for Google tab.");
    }

    // NOW register in webViews and show
    webViews[uniqueId] = {
      view: newView,
      session: newSession,
      url: targetUrl,
      name: serviceName,
      system: "google",
      service,
      email,
    };
    showView(uniqueId);
    updateMainLayout();

    // Show loader
    sendStatus("loading");
    await showLocalLoader(webContents);

    // Load the target URL directly - cookies should handle authentication
    log.info(`Loading ${targetUrl}...`);
    await webContents.loadURL(targetUrl);

    // Log final URL after any redirects
    log.info(`[Google] Loaded, final URL: ${webContents.getURL()}`);

    // Start title watcher to extract account name from Google page
    const startGoogleTitleWatcher = () => {
      try {
        const prev = webViews[uniqueId]?.titleTimer;
        if (prev) clearTimeout(prev);
      } catch (_) {}
      let lastTitle = null;
      const DEFAULT_TITLE = serviceName;
      const POLL_MS = 3000; // Poll every 3 seconds

      // Selectors for each Google service
      const titleSelectors = {
        analytics:
          "#suite-top-nav > gmp-header > gmp-universal-picker > button > span.mdc-button__label > div.gmp-button-text > span > span",
        ads: "body > div:nth-child(5) > root > div > div > awsm-app-bar > div.app-bar-left._ngcontent-awn-AWSM-0 > mcc-nav-slim > mcc-picker-wrapper > mcc-nav > nav-popup-trigger > div > mcc-nav-breadcrumb > div > div.operating-customer._ngcontent-awn-AWSM-14 > span.name._ngcontent-awn-AWSM-14",
        merchant: "accounts-menu .popup-trigger",
      };
      const selector = titleSelectors[service];
      if (!selector) return;

      const poll = async () => {
        try {
          if (
            !newView ||
            !newView.webContents ||
            newView.webContents.isDestroyed()
          ) {
            return;
          }
          let text;
          if (service === "merchant") {
            // For Merchant Center, extract from aria-label attribute
            text = await newView.webContents.executeJavaScript(
              `(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) return '';
                const ariaLabel = el.getAttribute('aria-label') || '';
                // aria-label format: "Účet Merchant Center: artmie.cz, 110664267"
                const match = ariaLabel.match(/:\\s*([^,]+)/);  
                return match ? match[1].trim() : '';
              })()`,
            );
          } else {
            text = await newView.webContents.executeJavaScript(
              `(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                return el ? (el.textContent || '').trim() : '';
              })()`,
            );
          }
          const next = text && text.length ? text : DEFAULT_TITLE;
          if (next !== lastTitle) {
            lastTitle = next;
            log.info(
              `[Google TitleWatcher] Title changed for ${service}: "${next}"`,
            );
            broadcastTabUi(uniqueId, "tab-title-update", {
              tabId: uniqueId,
              title: next,
            });
          }
        } catch (err) {
          // Ignore polling errors silently
        } finally {
          if (
            newView &&
            newView.webContents &&
            !newView.webContents.isDestroyed()
          ) {
            const t = setTimeout(poll, POLL_MS);
            if (webViews[uniqueId]) webViews[uniqueId].titleTimer = t;
          }
        }
      };
      poll();
    };
    webContents.on("did-finish-load", startGoogleTitleWatcher);
    webContents.on("did-navigate-in-page", startGoogleTitleWatcher);
    // Start immediately since page is already loaded
    startGoogleTitleWatcher();

    // Clear history so loader isn't in back navigation
    try {
      if (typeof webContents.clearHistory === "function") {
        webContents.clearHistory();
      }
    } catch (e) {
      log.warn("clearHistory after Google load failed:", e);
    }

    log.info(`Google ${service} tab opened successfully.`);
    return {
      success: true,
      id: uniqueId,
      name: serviceName,
    };
  } catch (error) {
    log.error("IPC: open-google-tab failed:", error);
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
      broadcastTabUi(uniqueId, "tab-status-update", {
        tabId: uniqueId,
        status,
        error,
        name: "Mergado",
        system: "mergado",
      });
    };
    webContents.on(
      "did-start-navigation",
      (event, url, isInPlace, isMainFrame) => {
        if (isMainFrame) sendStatus("loading");
      },
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
      },
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
          if (
            !newView ||
            !newView.webContents ||
            newView.webContents.isDestroyed()
          )
            return;
          const text = await newView.webContents.executeJavaScript(
            `(() => { const el = document.querySelector('#breadcrumb > a > span'); return el ? (el.textContent || '').trim() : ''; })()`,
          );
          const next = text && text.length ? text : "Mergado";
          if (next !== lastTitle) {
            lastTitle = next;
            broadcastTabUi(uniqueId, "tab-title-update", {
              tabId: uniqueId,
              title: next,
            });
          }
        } catch (_) {
          // ignore
        } finally {
          if (
            newView &&
            newView.webContents &&
            !newView.webContents.isDestroyed()
          ) {
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
      log.warn("Could not show local loader for Mergado (tabbed):", e),
    );

    // Continue heavy work asynchronously to return early
    (async () => {
      try {
        // Clear session and fetch cookies in parallel
        const clearPromise = Promise.all([
          newSession
            .clearStorageData()
            .catch((e) =>
              log.error("Failed to clear Mergado session storage:", e),
            ),
          newSession
            .clearCache()
            .catch((e) =>
              log.error("Failed to clear Mergado session cache:", e),
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
                log.error(`[MergadoTab] Err setting cookie '${name}':`, err),
              ),
          );
        }
        await Promise.all(allCookiePromises);

        await newView.webContents.loadURL(targetUrl);
        try {
          if (typeof newView.webContents.clearHistory === "function") {
            newView.webContents.clearHistory();
          }
        } catch (e) {
          log.warn("clearHistory after initial load failed (Mergado tab):", e);
        }
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

  // Setup application menu with keyboard shortcuts
  // This allows capturing Cmd+Left/Right on macOS which would otherwise be handled by the system
  const isMac = process.platform === "darwin";
  const menuTemplate = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    // Edit menu (for copy/paste to work)
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    // View menu with tab navigation
    {
      label: "View",
      submenu: [
        {
          label: "Previous Tab",
          accelerator: isMac ? "Cmd+Left" : "Ctrl+Left",
          click: () => {
            if (reactUiView && !reactUiView.webContents.isDestroyed()) {
              log.info("[Menu] Sending 'prevTab' action to React UI");
              reactUiView.webContents.send("keyboard-shortcut", {
                action: "prevTab",
              });
            }
          },
        },
        {
          label: "Next Tab",
          accelerator: isMac ? "Cmd+Right" : "Ctrl+Right",
          click: () => {
            if (reactUiView && !reactUiView.webContents.isDestroyed()) {
              log.info("[Menu] Sending 'nextTab' action to React UI");
              reactUiView.webContents.send("keyboard-shortcut", {
                action: "nextTab",
              });
            }
          },
        },
        { type: "separator" },
        {
          label: "Find",
          accelerator: "CmdOrCtrl+F",
          click: () => {
            if (reactUiView && !reactUiView.webContents.isDestroyed()) {
              log.info("[Menu] Sending 'find' action to React UI");
              reactUiView.webContents.send("keyboard-shortcut", {
                action: "find",
              });
              reactUiView.webContents.focus();
            }
          },
        },
        {
          label: "Refresh",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            if (reactUiView && !reactUiView.webContents.isDestroyed()) {
              log.info("[Menu] Sending 'refresh' action to React UI");
              reactUiView.webContents.send("keyboard-shortcut", {
                action: "refresh",
              });
            }
          },
        },
        { type: "separator" },
        {
          label: "New Tab",
          accelerator: "CmdOrCtrl+T",
          click: () => {
            if (reactUiView && !reactUiView.webContents.isDestroyed()) {
              log.info("[Menu] Sending 'newTab' action to React UI");
              reactUiView.webContents.send("keyboard-shortcut", {
                action: "newTab",
              });
              reactUiView.webContents.focus();
            }
          },
        },
        {
          label: "Go Home",
          accelerator: "Alt+H",
          click: () => {
            if (reactUiView && !reactUiView.webContents.isDestroyed()) {
              log.info("[Menu] Sending 'home' action to React UI");
              reactUiView.webContents.send("keyboard-shortcut", {
                action: "home",
              });
            }
          },
        },
        {
          label: "Copy URL",
          accelerator: "CmdOrCtrl+Shift+C",
          click: () => {
            if (reactUiView && !reactUiView.webContents.isDestroyed()) {
              log.info("[Menu] Sending 'copyUrl' action to React UI");
              reactUiView.webContents.send("keyboard-shortcut", {
                action: "copyUrl",
              });
            }
          },
        },
        {
          label: "Go Back",
          accelerator: "CmdOrCtrl+Backspace",
          click: () => {
            if (reactUiView && !reactUiView.webContents.isDestroyed()) {
              log.info("[Menu] Sending 'back' action to React UI");
              reactUiView.webContents.send("keyboard-shortcut", {
                action: "back",
              });
            }
          },
        },
      ],
    },
    // Window menu
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" }, { role: "front" }]
          : [{ role: "close" }]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
  log.info("Application menu with shortcuts configured.");

  // Register global shortcuts for Cmd+Left/Right (menu accelerators don't work for these on macOS)
  if (isMac) {
    const leftRegistered = globalShortcut.register("Command+Left", () => {
      if (reactUiView && !reactUiView.webContents.isDestroyed()) {
        log.info("[GlobalShortcut] Sending 'prevTab' action to React UI");
        reactUiView.webContents.send("keyboard-shortcut", {
          action: "prevTab",
        });
      }
    });
    const rightRegistered = globalShortcut.register("Command+Right", () => {
      if (reactUiView && !reactUiView.webContents.isDestroyed()) {
        log.info("[GlobalShortcut] Sending 'nextTab' action to React UI");
        reactUiView.webContents.send("keyboard-shortcut", {
          action: "nextTab",
        });
      }
    });
    log.info(
      `Global shortcuts for Cmd+Left/Right registered: Left=${leftRegistered}, Right=${rightRegistered}`,
    );
  } else {
    const leftRegistered = globalShortcut.register("Control+Left", () => {
      if (reactUiView && !reactUiView.webContents.isDestroyed()) {
        log.info("[GlobalShortcut] Sending 'prevTab' action to React UI");
        reactUiView.webContents.send("keyboard-shortcut", {
          action: "prevTab",
        });
      }
    });
    const rightRegistered = globalShortcut.register("Control+Right", () => {
      if (reactUiView && !reactUiView.webContents.isDestroyed()) {
        log.info("[GlobalShortcut] Sending 'nextTab' action to React UI");
        reactUiView.webContents.send("keyboard-shortcut", {
          action: "nextTab",
        });
      }
    });
    log.info(
      `Global shortcuts for Ctrl+Left/Right registered: Left=${leftRegistered}, Right=${rightRegistered}`,
    );
  }

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
        error,
      );
    });
  }
});

app.on("window-all-closed", () => {
  log.info("All windows closed.");
  // Odregistrovat globalShortcuts
  globalShortcut.unregisterAll();
  if (process.platform !== "darwin") {
    log.info("Quitting app...");
    app.quit();
  }
});

process.on("unhandledRejection", (reason, promise) => {
  log.error("Unhandled Rejection at:", promise, "reason:", reason);
});
