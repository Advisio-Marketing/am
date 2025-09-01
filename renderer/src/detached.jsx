import React, { useEffect, useMemo, useState, useCallback } from "react";
import ReactDOM from "react-dom/client";
import TabBar from "./components/TabBar.jsx";
import "./assets/App.css";

const TAB_BAR_HEIGHT = 40;

function DetachedApp() {
  const api =
    typeof window !== "undefined" && window.electronAPI
      ? window.electronAPI
      : null;
  const log =
    typeof window !== "undefined" && window.logger ? window.logger : console;

  // In detached windows we manage only one tab (the hosted native view), but
  // we keep a tiny TabBar so the user can drag it into other windows.
  const [tab, setTab] = useState(null); // { id, name, title, system }
  const [canGoBack, setCanGoBack] = useState(false);

  // Initialize from query string for immediate visual feedback
  useEffect(() => {
    try {
      const usp = new URLSearchParams(window.location.search || "");
      const initId = usp.get("tabId");
      const initName = usp.get("name");
      const initSystem = usp.get("system");
      if (initId) {
        setTab({
          id: initId,
          name: initName || "Tab",
          title: initName || "Tab",
          system: initSystem || "heureka",
          status: "ready",
        });
      }
    } catch (_) {}
  }, []);

  // The main process should send us initial metadata as soon as it loads us
  useEffect(() => {
    if (!api?.onTabStatusUpdate) return;
    const offStatus = api.onTabStatusUpdate(
      ({ tabId, status, name, system }) => {
        setTab((prev) => ({
          id: tabId,
          name: name || prev?.name || "Tab",
          title: prev?.title || name || "Tab",
          system: system || prev?.system || "heureka",
          status,
        }));
      }
    );
    const offTitle = api.onTabTitleUpdate?.(({ tabId, title }) => {
      setTab((prev) =>
        prev && prev.id === tabId
          ? { ...prev, title: title && title.length ? title : prev.name }
          : prev
      );
    });
    return () => {
      offStatus && offStatus();
      offTitle && offTitle();
    };
  }, [api]);

  // Poll canGoBack for this tab
  useEffect(() => {
    let stop = false;
    const run = async () => {
      if (!tab?.id) return;
      try {
        const res = await api?.canGoBack?.(tab.id);
        if (!stop) setCanGoBack(!!res?.canGoBack);
      } catch (_) {}
    };
    run();
    const t = setInterval(run, 1000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [api, tab?.id]);

  const tabs = useMemo(
    () =>
      tab
        ? [
            {
              id: tab.id,
              name: tab.name,
              title: tab.title,
              kind: "account",
              system: tab.system,
              status: tab.status || "ready",
            },
          ]
        : [],
    [tab]
  );

  const onSwitchTab = useCallback(() => {}, []);
  const onCloseTab = useCallback(async () => {
    // Close window handled natively by main; just request window close by closing the lone tab
    if (!tab?.id) return;
    await api?.closeTab?.(tab.id);
    window.close();
  }, [api, tab]);
  const onReorderTabs = useCallback(() => {}, []);
  const onGoHome = undefined; // hidden in detached
  const onToggleCollapse = () => {};
  const isSidebarCollapsed = true;
  const onRefresh = useCallback(async () => {
    if (tab?.id) await api?.refreshActiveTab?.(tab.id);
  }, [api, tab]);
  const onNewHomeTab = undefined; // hidden in detached
  const onBack = useCallback(async () => {
    if (tab?.id) await api?.goBack?.(tab.id);
  }, [api, tab]);
  const onDetachTab = undefined; // already detached

  return (
    <div className="app-container-main">
      <TabBar
        tabs={tabs}
        activeTabId={tab?.id || null}
        onSwitchTab={onSwitchTab}
        onCloseTab={onCloseTab}
        height={TAB_BAR_HEIGHT}
        onReorderTabs={onReorderTabs}
        onGoHome={onGoHome}
        onToggleCollapse={onToggleCollapse}
        isSidebarCollapsed={isSidebarCollapsed}
        onRefresh={onRefresh}
        onNewHomeTab={onNewHomeTab}
        onBack={onBack}
        canGoBack={canGoBack}
        onDetachTab={onDetachTab}
      />
      {!tab && (
        <div style={{ padding: 12, color: "#666", fontSize: 12 }}>
          Přetáhněte záložku na tento pruh, aby se připojila.
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <DetachedApp />
  </React.StrictMode>
);
