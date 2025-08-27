// main/preload.js
const { contextBridge, ipcRenderer } = require("electron");
const log = require("electron-log/renderer");

log.transports.ipc.level = "silly";

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

  googleLogout: () => ipcRenderer.invoke("google-logout"),

  refreshActiveTab: (accountId) =>
    ipcRenderer.invoke("refresh-active-tab", accountId),

  // Open Mergado as a tabbed view inside main layout
  openMergadoTab: () => ipcRenderer.invoke("open-mergado-tab"),
  // Overlay show/hide (to keep React modals above native WebContentsViews)
  overlayOpen: () => ipcRenderer.invoke("overlay-open"),
  overlayClose: () => ipcRenderer.invoke("overlay-close"),
});

contextBridge.exposeInMainWorld("logger", log.functions);
