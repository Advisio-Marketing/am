import React, { useState, useEffect, useCallback } from "react";
import LoginScreen from "./components/LoginScreen";
import AccountButton from "./components/AccountButton";
import StyledButton from "./components/StyledButton";
import Sidebar from "./components/SideBar";
import TabBar from "./components/TabBar";
import ContentPlaceholder from "./components/ContentPlaceholder";
import HomeTab from "./components/HomeTab";
import NewTabModal from "./components/NewTabModal";
import "./assets/App.css";

const DEFAULT_SIDEBAR_WIDTH = 250;
const MIN_SIDEBAR_WIDTH = 150;
const MAX_SIDEBAR_WIDTH = 500;
const TAB_BAR_HEIGHT = 40;

function App() {
  const api =
    typeof window !== "undefined" && window.electronAPI
      ? window.electronAPI
      : null;
  const log =
    typeof window !== "undefined" && window.logger ? window.logger : console;
  const [viewMode, setViewMode] = useState("login");
  const [userInfo, setUserInfo] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [errorLoadingAccounts, setErrorLoadingAccounts] = useState(null);
  const [openTabs, setOpenTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showNewTabModal, setShowNewTabModal] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  // Track tabs that were detached into their own window so we don't show them again in TabBar
  const [detachedTabIds, setDetachedTabIds] = useState(() => new Set());

  const [prevSidebarWidth, setPrevSidebarWidth] = useState(
    DEFAULT_SIDEBAR_WIDTH
  );

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;

      if (isSidebarCollapsed && e.clientX > 50) {
        setIsSidebarCollapsed(false);
        const newWidth = Math.max(e.clientX, MIN_SIDEBAR_WIDTH);
        setSidebarWidth(newWidth);
        api?.updateSidebarWidth?.(newWidth);
        return;
      }

      if (!isSidebarCollapsed) {
        const newWidth = Math.min(
          Math.max(e.clientX, MIN_SIDEBAR_WIDTH),
          MAX_SIDEBAR_WIDTH
        );
        setSidebarWidth(newWidth);
        api?.updateSidebarWidth?.(newWidth);

        if (e.clientX < MIN_SIDEBAR_WIDTH / 2) {
          setIsSidebarCollapsed(true);
        }
      }
    };

    const stopResizing = () => {
      setIsResizing(false);
      document.body.classList.remove("no-select");
    };

    if (isResizing) {
      document.body.classList.add("no-select");
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResizing);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResizing);
      document.body.classList.remove("no-select");
    };
  }, [isResizing, isSidebarCollapsed]);

  useEffect(() => {
    if (!api?.onTabStatusUpdate) return;
    const removeStatusListener = api.onTabStatusUpdate(
      ({ tabId, accountId, status, error, name, system }) => {
        const id = tabId || accountId; // backwards compatibility
        // Completely ignore status updates for tabs that are currently detached
        if (id && detachedTabIds.has(id)) return;
        setOpenTabs((currentTabs) => {
          const existingTabIndex = currentTabs.findIndex(
            (tab) => tab.id === id
          );
          if (existingTabIndex > -1) {
            const newTabs = [...currentTabs];
            newTabs[existingTabIndex] = {
              ...newTabs[existingTabIndex],
              status,
              error: error || null,
              ...(system ? { system } : {}),
              ...(accountId ? { accountId } : {}),
            };
            return newTabs;
          } else if (status !== "error" && name) {
            const idToUse = id;
            if (!currentTabs.some((tab) => tab.id === idToUse)) {
              return [
                ...currentTabs,
                {
                  id: idToUse,
                  accountId: accountId || null,
                  name: name,
                  status,
                  error: null,
                  kind: "account",
                  system: system || "heureka",
                },
              ];
            }
          }
          return currentTabs;
        });
        if (status === "ready" && !activeTabId) {
          const candidate = id;
          const existsInTabs = openTabs.some((t) => t.id === candidate);
          if (candidate && existsInTabs && !detachedTabIds.has(candidate)) {
            setActiveTabId(candidate);
          }
        }
        // When the active tab navigates/loads, update back availability
        if (id && id === activeTabId) {
          api
            ?.canGoBack?.(id)
            .then((res) => setCanGoBack(!!res?.canGoBack))
            .catch(() => setCanGoBack(false));
        }
      }
    );

    const removeActivateListener = api.onActivateTab((accountId) => {
      if (!accountId) return;
      // If this id had been detached, clear the flag to allow reattach
      if (detachedTabIds.has(accountId)) {
        setDetachedTabIds((prev) => {
          const next = new Set(prev);
          next.delete(accountId);
          return next;
        });
      }
      // Set active even if the tab isn't in openTabs yet; it will be added by the next status update
      setActiveTabId(accountId);
    });

    const removeForceCloseListener = api.onForceCloseTab((accountId) => {
      setOpenTabs((currentTabs) =>
        currentTabs.filter((tab) => tab.id !== accountId)
      );
      // Mark this id as detached so title/activate events are ignored until reattach
      setDetachedTabIds((prev) => {
        const next = new Set(prev);
        next.add(accountId);
        return next;
      });
    });

    const removeTitleListener = api.onTabTitleUpdate?.(({ tabId, title }) => {
      if (!tabId) return;
      if (detachedTabIds.has(tabId)) return; // ignore title changes from detached windows
      setOpenTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === tabId
            ? { ...tab, title: title && title.length ? title : tab.name }
            : tab
        )
      );
    });

    return () => {
      removeStatusListener();
      removeActivateListener();
      removeForceCloseListener();
      removeTitleListener && removeTitleListener();
    };
  }, [activeTabId, api, openTabs, detachedTabIds]);

  const handleGoogleLogin = useCallback(
    (userInfo) => {
      log.info("Google login successful for user:", userInfo);
      setUserInfo(userInfo);
      setViewMode("initial");
    },
    [log]
  );

  // Otevření Mergada jako nový tab (account-like)
  const handleOpenMergado = useCallback(async () => {
    try {
      const res = await api?.openMergadoTab?.();
      if (!res?.success)
        throw new Error(res?.error || "Nepodařilo se otevřít Mergado.");
      const { id, name } = res;
      setOpenTabs((prev) => {
        if (prev.some((t) => t.id === id)) return prev;
        return [
          ...prev,
          {
            id,
            name: name || "Mergado",
            title: "Mergado",
            status: "loading",
            kind: "account",
            system: "mergado",
          },
        ];
      });
      setActiveTabId(id);
    } catch (e) {
      log.error("Open Mergado failed:", e);
    }
  }, [api, log]);

  const handleInitialButtonClick = useCallback(
    async (accountName) => {
      if (accountName === "Heureka") {
        log.warn("It`s Heureka!");
        // Show main layout and immediately open a Heureka hub tab so the sidebar is visible
        try {
          await api?.showMainLayout?.();
          api?.updateSidebarWidth?.(sidebarWidth);
          const hubId = `hub-heureka-${Date.now()}`;
          setOpenTabs((prev) => [
            ...prev,
            {
              id: hubId,
              name: "Heureka",
              title: "Heureka",
              kind: "hub",
              system: "heureka",
              status: "ready",
            },
          ]);
          setActiveTabId(hubId);
          // Ensure native views are hidden when switching to Heureka hub
          await api?.switchTab?.(null);
          setViewMode("main");

          // Load accounts in background (the sidebar will show loading state)
          setIsLoadingAccounts(true);
          setErrorLoadingAccounts(null);
          const list = await api?.fetchAccountListHeureka?.();
          if (Array.isArray(list)) {
            const formattedList = list.map((item) => ({
              id: String(item.id),
              name: item.client_name || `Účet ${item.id}`,
              client_country: item?.client_country,
              client_email: item?.client_email || "",
            }));
            setAccounts(formattedList);
          } else {
            throw new Error("Neplatná data účtů.");
          }
        } catch (err) {
          setErrorLoadingAccounts(`Chyba: ${err.message}`);
        } finally {
          setIsLoadingAccounts(false);
        }
      } else if (accountName === "Mergado") {
        log.warn("It`s Mergado!");
        try {
          await api?.showMainLayout?.();
          setViewMode("main");
          api?.updateSidebarWidth?.(sidebarWidth);
          await handleOpenMergado();
        } catch (err) {
          log.error("Mergado open failed:", err);
        }
      }
    },
    [sidebarWidth, handleOpenMergado, api, log]
  );

  const handleToggleCollapse = useCallback(() => {
    if (isSidebarCollapsed) {
      setIsSidebarCollapsed(false);
      setSidebarWidth(prevSidebarWidth);
      api?.updateSidebarWidth?.(prevSidebarWidth);
    } else {
      setPrevSidebarWidth(sidebarWidth);
      setIsSidebarCollapsed(true);
      api?.updateSidebarWidth?.(40);
    }
  }, [isSidebarCollapsed, sidebarWidth, prevSidebarWidth, api]);

  const handleStartResize = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleSwitchTab = useCallback(
    async (tabId) => {
      if (activeTabId === tabId) return;
      const target = openTabs.find((t) => t.id === tabId);
      if (!target) return;
      // For non-account tabs (home/hub), hide native views in main process
      if (target.kind !== "account") {
        await api?.switchTab?.(null);
        setActiveTabId(tabId);
        setCanGoBack(false);
        return;
      }
      const result = await api?.switchTab?.(tabId);
      if (result.success) {
        setActiveTabId(tabId);
        // update canGoBack when switching tabs
        try {
          const res = await api?.canGoBack?.(tabId);
          setCanGoBack(!!res?.canGoBack);
        } catch (_) {
          setCanGoBack(false);
        }
      }
    },
    [activeTabId, openTabs, api]
  );

  const handleSidebarSelect = useCallback(
    async (account) => {
      const activeTab = openTabs.find((t) => t.id === activeTabId);
      const isPlaceholder = activeTab ? activeTab.kind !== "account" : false;
      const newTabId = `${account.id}-${Date.now()}-${Math.floor(
        Math.random() * 1e6
      )}`;

      if (isPlaceholder) {
        // Replace placeholder tab in-place with a new unique Heureka tab
        setOpenTabs((prev) => {
          const idx = prev.findIndex((t) => t.id === activeTabId);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = {
            id: newTabId,
            accountId: account.id,
            name: account.name,
            title: account.tabTitle || undefined,
            tooltip: account.tabTooltip || undefined,
            status: "loading",
            error: null,
            kind: "account",
            system: "heureka",
          };
          return next;
        });
        setActiveTabId(newTabId);
      } else {
        setActiveTabId(newTabId);
        setOpenTabs((prev) => [
          ...prev,
          {
            id: newTabId,
            accountId: account.id,
            name: account.name,
            // pokud přichází ze skupiny, použijeme e-mail jako titulek záložky
            title: account.tabTitle || undefined,
            tooltip: account.tabTooltip || undefined,
            status: "loading",
            error: null,
            kind: "account",
            system: "heureka",
          },
        ]);
      }
      const result = await api?.selectAccount?.({
        ...account,
        tabId: newTabId,
      });
      if (!result?.success) {
        log.error(
          `Failed to initiate select for ${account.id}:`,
          result?.error
        );
      }
    },
    [openTabs, activeTabId, api, log]
  );

  const handleCloseTab = useCallback(
    async (tabId) => {
      const target = openTabs.find((t) => t.id === tabId);
      const remainingTabs = openTabs.filter((tab) => tab.id !== tabId);
      setOpenTabs(remainingTabs);
      if (activeTabId === tabId) {
        const newActiveId = remainingTabs.length
          ? remainingTabs[remainingTabs.length - 1].id
          : null;
        if (newActiveId) {
          const next = remainingTabs.find((t) => t.id === newActiveId);
          if (next && next.kind === "account")
            await api?.switchTab?.(newActiveId);
          setActiveTabId(newActiveId);
          // refresh back availability for the newly active tab
          try {
            const res = await api?.canGoBack?.(newActiveId);
            setCanGoBack(!!res?.canGoBack);
          } catch (_) {
            setCanGoBack(false);
          }
        } else {
          await api?.switchTab?.(null);
          setActiveTabId(null);
          setCanGoBack(false);
        }
      }
      if (target && target.kind === "account") {
        const result = await api?.closeTab?.(tabId);
        if (!result.success) {
          log.error(
            `Failed to close tab ${tabId} in main process:`,
            result.error
          );
        }
      }
    },
    [activeTabId, openTabs, api, log]
  );

  const handleReorderTabs = useCallback(
    (fromId, toId) => {
      const fromIndex = openTabs.findIndex((tab) => tab.id === fromId);
      const toIndex = openTabs.findIndex((tab) => tab.id === toId);
      if (fromIndex === -1 || toIndex === -1) return;
      setOpenTabs((prev) => {
        const arr = [...prev];
        const [moved] = arr.splice(fromIndex, 1);
        arr.splice(toIndex, 0, moved);
        return arr;
      });
    },
    [openTabs]
  );

  // Detach an account tab into a separate window: remove it from state and track as detached
  const handleDetachTab = useCallback(
    async (tabId) => {
      const target = openTabs.find((t) => t.id === tabId);
      if (!target || target.kind !== "account") return;
      // Remove from open tabs immediately
      setOpenTabs((prev) => prev.filter((t) => t.id !== tabId));
      // Update active tab if needed
      if (activeTabId === tabId) {
        const remaining = openTabs.filter((t) => t.id !== tabId);
        const newActive = remaining.length
          ? remaining[remaining.length - 1]
          : null;
        if (newActive) {
          if (newActive.kind === "account")
            await api?.switchTab?.(newActive.id);
          else await api?.switchTab?.(null);
          setActiveTabId(newActive.id);
        } else {
          await api?.switchTab?.(null);
          setActiveTabId(null);
        }
      }
      // Mark as detached so we ignore further updates
      setDetachedTabIds((prev) => new Set(prev).add(tabId));
      // Ask main to detach (open new window/move native view)
      try {
        await api?.detachTab?.(tabId);
      } catch (e) {
        // If detach failed, allow user to re-open later; keep it detached in UI to avoid flicker
        log.error("detachTab failed:", e);
      }
    },
    [openTabs, activeTabId, api, log]
  );

  const handleLogout = useCallback(async () => {
    log.info("Logging out user...");
    try {
      await api?.googleLogout?.();
      log.info("Token successfully deleted from main process.");
    } catch (error) {
      log.warn("Failed to delete token via main process:", error);
    }
    setUserInfo(null);
    setAccounts([]);
    setOpenTabs([]);
    setActiveTabId(null);
    setViewMode("login");
    setDetachedTabIds(new Set());
    api?.resetToHome?.().catch((error) => {
      log.error("Error during logout reset:", error);
    });
  }, [api, log]);

  // React to auth-expired from main process (e.g., refresh failure or missing token)
  useEffect(() => {
    if (!api?.onAuthExpired) return;
    const remove = api.onAuthExpired((_payload) => {
      log.warn(
        "Auth expired notification received. Returning to login screen."
      );
      // Don't call googleLogout here; main already revoked/cleared. Just reset UI state.
      setUserInfo(null);
      setAccounts([]);
      setOpenTabs([]);
      setActiveTabId(null);
      setViewMode("login");
    });
    return () => remove && remove();
  }, [api, log]);

  const handleSearchChange = useCallback((event) => {
    setSearchTerm(event.target.value);
  }, []);

  // Refresh active account tab (no-op for home/hub)
  const handleRefresh = useCallback(
    async (tabId) => {
      if (!tabId) {
        log.info("No active tab to refresh.");
        return;
      }
      const target = openTabs.find((t) => t.id === tabId);
      if (!target || target.kind !== "account") return;
      setOpenTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === tabId ? { ...tab, status: "loading", error: null } : tab
        )
      );
      log.info(`Requesting refresh for tab: ${tabId}`);
      try {
        await api?.refreshActiveTab?.(tabId);
        // after refresh, history remains; keep canGoBack as-is but re-check in case first load
        try {
          const res = await api?.canGoBack?.(tabId);
          setCanGoBack(!!res?.canGoBack);
        } catch (_) {}
      } catch (error) {
        log.error(`Failed to call refresh for tab ${tabId}:`, error);
        setOpenTabs((currentTabs) =>
          currentTabs.map((tab) =>
            tab.id === tabId
              ? { ...tab, status: "error", error: String(error) }
              : tab
          )
        );
      }
    },
    [openTabs, api, log]
  );

  // Update canGoBack on navigation events for active tab: listen to status updates and poll canGoBack
  useEffect(() => {
    let canceled = false;
    const update = async () => {
      if (!activeTabId) {
        setCanGoBack(false);
        return;
      }
      try {
        const res = await api?.canGoBack?.(activeTabId);
        if (!canceled) setCanGoBack(!!res?.canGoBack);
      } catch (_) {
        if (!canceled) setCanGoBack(false);
      }
    };
    update();
    return () => {
      canceled = true;
    };
  }, [activeTabId, api]);

  const handleBack = useCallback(async () => {
    if (!activeTabId) return;
    try {
      const res = await api?.goBack?.(activeTabId);
      if (!res?.success) return;
      // After going back, re-check availability
      const st = await api?.canGoBack?.(activeTabId);
      setCanGoBack(!!st?.canGoBack);
    } catch (_) {
      // ignore
    }
  }, [activeTabId, api]);

  // Home icon: close all tabs/processes and go to initial screen
  const handleGoHome = useCallback(async () => {
    try {
      setOpenTabs([]);
      setActiveTabId(null);
      setViewMode("initial");
      setDetachedTabIds(new Set());
      await api?.resetToHome?.();
    } catch (e) {
      log.error("resetToHome failed:", e);
    }
  }, [api, log]);

  // "+" button now opens system picker modal
  const handleNewHomeTab = useCallback(() => {
    api?.overlayOpen?.();
    setShowNewTabModal(true);
  }, []);

  const handlePickNewHeureka = useCallback(async () => {
    setShowNewTabModal(false);
    api?.overlayClose?.();
    try {
      await api?.showMainLayout?.();
      api?.updateSidebarWidth?.(sidebarWidth);
      const newId = `hub-heureka-${Date.now()}`;
      setOpenTabs((prev) => [
        ...prev,
        {
          id: newId,
          name: "Heureka",
          title: "Heureka",
          kind: "hub",
          system: "heureka",
          status: "ready",
        },
      ]);
      setActiveTabId(newId);
      // Hide native views when activating Heureka hub
      await api?.switchTab?.(null);
      if (!accounts?.length) {
        setIsLoadingAccounts(true);
        setErrorLoadingAccounts(null);
        try {
          const list = await api?.fetchAccountListHeureka?.();
          if (Array.isArray(list)) {
            const formattedList = list.map((item) => ({
              id: String(item.id),
              name: item.client_name || `Účet ${item.id}`,
              client_country: item?.client_country,
              client_email: item?.client_email || "",
            }));
            setAccounts(formattedList);
            setViewMode("main");
          }
        } catch (e) {
          setErrorLoadingAccounts(String(e?.message || e));
        } finally {
          setIsLoadingAccounts(false);
        }
      } else {
        setViewMode("main");
      }
    } catch (e) {
      log.error("Pick Heureka failed:", e);
    }
  }, [api, accounts, log, sidebarWidth]);

  const handlePickNewMergado = useCallback(async () => {
    setShowNewTabModal(false);
    api?.overlayClose?.();
    try {
      await api?.showMainLayout?.();
      setViewMode("main");
      api?.updateSidebarWidth?.(sidebarWidth);
      await handleOpenMergado();
    } catch (e) {
      log.error("Pick Mergado failed:", e);
    }
  }, [api, log, sidebarWidth, handleOpenMergado]);

  // Skupinové zobrazení účtů podle e-mailu: víc účtů pod jedním e-mailem -> jeden řádek s e-mailem
  const displayAccounts = React.useMemo(() => {
    const emailMap = new Map();
    for (const acc of accounts) {
      const email = (acc.client_email || "").trim().toLowerCase();
      if (!emailMap.has(email)) emailMap.set(email, []);
      emailMap.get(email).push(acc);
    }

    const items = [];
    for (const [email, list] of emailMap.entries()) {
      if (list.length > 1 && email) {
        // víc účtů pod jedním emailem -> skupiny dle země (CZ/SK) pokud jsou obě
        const byCountry = list.reduce(
          (acc, a) => {
            const cc = String(a.client_country || "").toLowerCase();
            if (cc === "cz") acc.cz.push(a);
            else if (cc === "sk") acc.sk.push(a);
            else acc.other.push(a);
            return acc;
          },
          { cz: [], sk: [], other: [] }
        );

        const pushGroup = (subset, suffixLabel) => {
          if (!subset.length) return;
          const representative = [...subset].sort(
            (a, b) => Number(a.id) - Number(b.id)
          )[0];
          const tooltipNames = subset
            .map(
              (a) =>
                `${a.name || `Účet ${a.id}`}${
                  a.client_country ? ` (${a.client_country})` : ""
                }`
            )
            .join(", ");
          items.push({
            id: representative.id,
            name: suffixLabel ? `${email} ${suffixLabel}` : email,
            client_country: representative.client_country,
            client_email: email,
            group: true,
            representative,
            groupAccounts: subset,
            tooltip: tooltipNames,
          });
        };

        // Pokud existují jak CZ, tak SK, zobrazíme dvě skupiny se suffixy
        if (byCountry.cz.length && byCountry.sk.length) {
          pushGroup(byCountry.cz, "CZ");
          pushGroup(byCountry.sk, "SK");
          // ostatní země (pokud by se objevily) dáme do samostatné skupiny bez suffixu
          if (byCountry.other.length) pushGroup(byCountry.other, "");
        } else {
          // jinak zachováme původní chování: jedna skupina pod e‑mailem
          pushGroup(list, "");
        }
      } else {
        // jeden účet pro daný email nebo email prázdný -> zobrazíme standardně
        for (const a of list) {
          items.push({ ...a, group: false });
        }
      }
    }

    // Filtrování podle vyhledávání: hledáme v názvu účtu i v e-mailu/skupině
    const term = searchTerm.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => {
      if (item.group) {
        const emailHit = item.name.toLowerCase().includes(term);
        const namesHit = item.groupAccounts?.some((a) =>
          (a.name || "").toLowerCase().includes(term)
        );
        return emailHit || namesHit;
      }
      return (
        (item.name || "").toLowerCase().includes(term) ||
        (item.client_email || "").toLowerCase().includes(term)
      );
    });
  }, [accounts, searchTerm]);

  const handleDisabled = () => {
    alert("Na této službě se pracuje.");
  };

  if (viewMode === "login") {
    return <LoginScreen onLogin={handleGoogleLogin} />;
  }

  if (viewMode === "initial") {
    return (
      <div
        className={`app-container-initial ${
          viewMode === "initial" ? "with-back-img" : null
        }`}
      >
        <div className="initial-header">
          {userInfo && (
            <div className="user-info">
              <span className="user-name">
                {userInfo.name} ({userInfo.email})
              </span>
              <StyledButton
                onClick={handleLogout}
                variant="danger"
                title="Odhlásit se"
              >
                Odhlásit
              </StyledButton>
            </div>
          )}
        </div>

        {errorLoadingAccounts && (
          <div style={{ color: "red", textAlign: "center" }}>
            <p>Chyba při načítání seznamu účtů:</p>
            <p>{errorLoadingAccounts}</p>
            {/* <button
              onClick={() => handleInitialButtonClick("Heureka")}
              style={{ marginTop: "10px" }}
            >
              Zkusit znovu?
            </button> */}
          </div>
        )}
        {!errorLoadingAccounts && (
          <div className="initial-btn-box">
            <AccountButton
              accountName="Heureka"
              onClick={handleInitialButtonClick}
              disabled={isLoadingAccounts}
              loading={isLoadingAccounts}
            />
            <AccountButton
              accountName="Mergado"
              onClick={handleInitialButtonClick}
              disabled={isLoadingAccounts}
              loading={isLoadingAccounts}
            />
            <AccountButton
              accountName="Glami"
              onClick={handleDisabled}
              disabled={true}
            />
            <AccountButton
              accountName="Favi"
              onClick={handleDisabled}
              disabled={true}
            />
            <AccountButton
              accountName="Biano"
              onClick={handleDisabled}
              disabled={true}
            />
          </div>
        )}
      </div>
    );
  }

  const activeTabInfo = openTabs.find((tab) => tab.id === activeTabId);
  const showSidebar = activeTabInfo?.system === "heureka";

  return (
    <div className={`app-container-main ${isResizing ? "resizing" : ""}`}>
      <TabBar
        tabs={openTabs}
        activeTabId={activeTabId}
        onSwitchTab={handleSwitchTab}
        onCloseTab={handleCloseTab}
        height={TAB_BAR_HEIGHT}
        onReorderTabs={handleReorderTabs}
        onGoHome={handleGoHome}
        onToggleCollapse={handleToggleCollapse}
        isSidebarCollapsed={isSidebarCollapsed}
        onRefresh={handleRefresh}
        onNewHomeTab={handleNewHomeTab}
        onBack={handleBack}
        canGoBack={canGoBack}
        onDetachTab={handleDetachTab}
      />
      <div className="main-row">
        {showSidebar && (
          <Sidebar
            accounts={displayAccounts}
            onSelect={handleSidebarSelect}
            width={sidebarWidth}
            isLoading={isLoadingAccounts}
            error={errorLoadingAccounts}
            searchTerm={searchTerm}
            onSearchChange={handleSearchChange}
            selectedAccountId={activeTabInfo?.accountId || null}
            onGoHome={handleGoHome}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={handleToggleCollapse}
            onStartResize={handleStartResize}
            isResizing={isResizing}
            onRefresh={handleRefresh}
          />
        )}
        <div className={`main-content-wrapper ${isResizing ? "resizing" : ""}`}>
          {activeTabInfo?.kind === "home" ? (
            <HomeTab
              userInfo={userInfo}
              onHeureka={async () => {
                // Replace current home tab with Heureka hub (keeps same position and id)
                const beforeId = activeTabInfo.id;
                await api?.showMainLayout?.();
                api?.updateSidebarWidth?.(sidebarWidth);
                setOpenTabs((prev) => {
                  const idx = prev.findIndex((t) => t.id === beforeId);
                  if (idx === -1) return prev;
                  const next = [...prev];
                  next[idx] = {
                    id: beforeId,
                    name: "Heureka",
                    title: "Heureka",
                    kind: "hub",
                    system: "heureka",
                    status: "ready",
                  };
                  return next;
                });
                setActiveTabId(beforeId);
                // Hide native views when switching to Heureka hub
                await api?.switchTab?.(null);
                // If accounts are not loaded yet, fetch them so the sidebar shows immediately
                if (!accounts?.length) {
                  setIsLoadingAccounts(true);
                  setErrorLoadingAccounts(null);
                  try {
                    const list = await api?.fetchAccountListHeureka?.();
                    if (Array.isArray(list)) {
                      const formattedList = list.map((item) => ({
                        id: String(item.id),
                        name: item.client_name || `Účet ${item.id}`,
                        client_country: item?.client_country,
                        client_email: item?.client_email || "",
                      }));
                      setAccounts(formattedList);
                    }
                  } catch (e) {
                    setErrorLoadingAccounts(String(e?.message || e));
                  } finally {
                    setIsLoadingAccounts(false);
                  }
                }
              }}
              onMergado={async () => {
                // Replace current home tab at same position with Mergado tab
                const beforeId = activeTabInfo.id;
                try {
                  const res = await api?.openMergadoTab?.();
                  if (!res?.success)
                    throw new Error(
                      res?.error || "Nepodařilo se otevřít Mergado."
                    );
                  const { id, name } = res;
                  setOpenTabs((prev) => {
                    const idx = prev.findIndex((t) => t.id === beforeId);
                    if (idx === -1) return prev;
                    const withoutDup = prev.filter(
                      (t) => t.id !== id && t.id !== beforeId
                    );
                    const next = [...withoutDup];
                    next.splice(idx, 0, {
                      id,
                      name: name || "Mergado",
                      title: "Mergado",
                      status: "loading",
                      kind: "account",
                      system: "mergado",
                    });
                    return next;
                  });
                  setActiveTabId(id);
                } catch (e) {
                  log.error("Open Mergado in-place failed:", e);
                }
              }}
              isLoading={isLoadingAccounts}
            />
          ) : (
            <ContentPlaceholder activeTab={activeTabInfo} />
          )}
        </div>
      </div>
      {showNewTabModal && (
        <NewTabModal
          onClose={() => {
            setShowNewTabModal(false);
            api?.overlayClose?.();
          }}
          onPickHeureka={handlePickNewHeureka}
          onPickMergado={handlePickNewMergado}
        />
      )}
    </div>
  );
}

export default App;

// Note: global logger is provided by preload via window.logger
