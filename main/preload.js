// main/preload.js
const { contextBridge, ipcRenderer } = require("electron");
let log;
try {
  log = require("electron-log/renderer");
  if (log?.transports?.ipc) log.transports.ipc.level = "silly";
} catch (e) {
  // Fallback to a minimal console-backed logger to avoid runtime errors in prod
  const passthrough =
    (method) =>
    (...args) =>
      console[method](...args);
  log = {
    functions: {
      log: passthrough("log"),
      info: passthrough("info"),
      warn: passthrough("warn"),
      error: passthrough("error"),
      debug: passthrough("log"),
    },
  };
}

contextBridge.exposeInMainWorld("electronAPI", {
  // Google Authentication
  googleAuth: () => ipcRenderer.invoke("google-auth"),

  // Po kliknutí na úvodní tlačítko
  fetchAccountListHeureka: () =>
    ipcRenderer.invoke("fetch-account-list-heureka"),
  fetchMergado: () => ipcRenderer.invoke("fetch-mergado"),
  showMainLayout: () => ipcRenderer.invoke("show-main-layout"),

  // Po kliknutí v sidebaru
  selectAccount: (accountInfo) =>
    ipcRenderer.invoke("select-account", accountInfo),

  // Po kliknutí na tab
  switchTab: (accountId) => ipcRenderer.invoke("switch-tab", accountId),

  // Kontextové menu na záložce
  showTabContextMenu: (tabId) =>
    ipcRenderer.invoke("show-tab-context-menu", tabId),

  // Detach tab via drag-out
  detachTab: (tabId) => ipcRenderer.invoke("detach-tab", tabId),

  // Po kliknutí na 'x' na tabu
  closeTab: (accountId) => ipcRenderer.invoke("close-tab", accountId),

  resetToHome: () => ipcRenderer.invoke("reset-to-home"),

  // Sidebar resizing
  updateSidebarWidth: (width) =>
    ipcRenderer.invoke("update-sidebar-width", width),

  // Listenery pro zprávy z Main procesu
  onTabStatusUpdate: (callback) => {
    const listener = (_event, statusUpdate) => callback(statusUpdate);
    ipcRenderer.on("tab-status-update", listener);
    return () => ipcRenderer.removeListener("tab-status-update", listener);
  },
  onActivateTab: (callback) => {
    const listener = (_event, accountId) => callback(accountId);
    ipcRenderer.on("activate-tab", listener);
    return () => ipcRenderer.removeListener("activate-tab", listener);
  },
  onForceCloseTab: (callback) => {
    const listener = (_event, accountId) => callback(accountId);
    ipcRenderer.on("force-close-tab", listener);
    return () => ipcRenderer.removeListener("force-close-tab", listener);
  },
  onTabTitleUpdate: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("tab-title-update", listener);
    return () => ipcRenderer.removeListener("tab-title-update", listener);
  },

  // Hover indicator for reattaching a detached window over TabBar
  onTabbarDetachHover: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("tabbar-detach-hover", listener);
    return () => ipcRenderer.removeListener("tabbar-detach-hover", listener);
  },

  googleLogout: () => ipcRenderer.invoke("google-logout"),

  refreshActiveTab: (accountId) =>
    ipcRenderer.invoke("refresh-active-tab", accountId),

  // Navigation: back in current tab
  canGoBack: (tabId) => ipcRenderer.invoke("can-go-back", tabId),
  goBack: (tabId) => ipcRenderer.invoke("go-back", tabId),

  // Open Mergado as a tabbed view inside main layout
  openMergadoTab: () => ipcRenderer.invoke("open-mergado-tab"),
  // Overlay show/hide (to keep React modals above native WebContentsViews)
  overlayOpen: () => ipcRenderer.invoke("overlay-open"),
  overlayClose: () => ipcRenderer.invoke("overlay-close"),
});

try {
  contextBridge.exposeInMainWorld("logger", log.functions || log);
} catch (_) {
  // no-op
}
