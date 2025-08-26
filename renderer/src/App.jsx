import React, { useState, useEffect, useCallback } from "react";
import LoginScreen from "./components/LoginScreen";
import AccountButton from "./components/AccountButton";
import StyledButton from "./components/StyledButton";
import Sidebar from "./components/SideBar";
import TabBar from "./components/TabBar";
import ContentPlaceholder from "./components/ContentPlaceholder";
import "./assets/App.css";

const DEFAULT_SIDEBAR_WIDTH = 250;
const MIN_SIDEBAR_WIDTH = 150;
const MAX_SIDEBAR_WIDTH = 500;
const TAB_BAR_HEIGHT = 40;

function App() {
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
        window.electronAPI.updateSidebarWidth(newWidth);
        return;
      }

      if (!isSidebarCollapsed) {
        const newWidth = Math.min(
          Math.max(e.clientX, MIN_SIDEBAR_WIDTH),
          MAX_SIDEBAR_WIDTH
        );
        setSidebarWidth(newWidth);
        window.electronAPI.updateSidebarWidth(newWidth);

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
    const removeStatusListener = window.electronAPI.onTabStatusUpdate(
      ({ accountId, status, error, name }) => {
        setOpenTabs((currentTabs) => {
          const existingTabIndex = currentTabs.findIndex(
            (tab) => tab.id === accountId
          );
          if (existingTabIndex > -1) {
            const newTabs = [...currentTabs];
            newTabs[existingTabIndex] = {
              ...newTabs[existingTabIndex],
              status,
              error: error || null,
            };
            return newTabs;
          } else if (status !== "error" && name) {
            if (!currentTabs.some((tab) => tab.id === accountId)) {
              return [
                ...currentTabs,
                { id: accountId, name: name, status, error: null },
              ];
            }
          }
          return currentTabs;
        });
        if (status === "ready" && !activeTabId) {
          setActiveTabId(accountId);
        }
      }
    );

    const removeActivateListener = window.electronAPI.onActivateTab(
      (accountId) => {
        setActiveTabId(accountId);
      }
    );

    const removeForceCloseListener = window.electronAPI.onForceCloseTab(
      (accountId) => {
        setOpenTabs((currentTabs) =>
          currentTabs.filter((tab) => tab.id !== accountId)
        );
      }
    );

    return () => {
      removeStatusListener();
      removeActivateListener();
      removeForceCloseListener();
    };
  }, [activeTabId]);

  const handleGoogleLogin = useCallback((userInfo) => {
    console.log("Google login successful for user:", userInfo);
    setUserInfo(userInfo);
    setViewMode("initial");
  }, []);

  const handleInitialButtonClick = useCallback(
    async (accountName) => {
      setIsLoadingAccounts(true);
      setErrorLoadingAccounts(null);
      try {
        await window.electronAPI.showMainLayout();
        if (accountName === "Heureka") {
          console.log("Heureka");
          const list = await window.electronAPI.fetchAccountListHeureka();
          if (Array.isArray(list)) {
            const formattedList = list.map((item) => ({
              id: String(item.id),
              name: item.client_name || `Účet ${item.id}`,
              client_country: item?.client_country,
              client_email: item?.client_email || "",
            }));
            setAccounts(formattedList);
            setViewMode("main");

            window.electronAPI.updateSidebarWidth(sidebarWidth);

            const clickedAccount = formattedList.find((acc) =>
              acc.name.includes(accountName)
            );
            if (clickedAccount) {
              handleSidebarSelect(clickedAccount);
            }
          } else {
            console.log("else");
          }
        } else {
          throw new Error("Neplatná data účtů.");
        }
      } catch (err) {
        setErrorLoadingAccounts(`Chyba: ${err.message}`);
      } finally {
        setIsLoadingAccounts(false);
      }
    },
    [sidebarWidth]
  );

  const handleToggleCollapse = useCallback(() => {
    if (isSidebarCollapsed) {
      setIsSidebarCollapsed(false);
      setSidebarWidth(prevSidebarWidth);
      window.electronAPI.updateSidebarWidth(prevSidebarWidth);
    } else {
      setPrevSidebarWidth(sidebarWidth);
      setIsSidebarCollapsed(true);
      window.electronAPI.updateSidebarWidth(40);
    }
  }, [isSidebarCollapsed, sidebarWidth, prevSidebarWidth]);

  const handleStartResize = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleSidebarSelect = useCallback(
    async (account) => {
      const isAlreadyOpen = openTabs.some((tab) => tab.id === account.id);
      if (isAlreadyOpen) {
        if (activeTabId !== account.id) {
          handleSwitchTab(account.id);
        }
      } else {
        setActiveTabId(account.id);
        setOpenTabs((prev) => [
          ...prev,
          {
            id: account.id,
            name: account.name,
            // pokud přichází ze skupiny, použijeme e-mail jako titulek záložky
            title: account.tabTitle || undefined,
            tooltip: account.tabTooltip || undefined,
            status: "loading",
            error: null,
          },
        ]);
        const result = await window.electronAPI.selectAccount(account);
        if (!result.success) {
          console.error(
            `Failed to initiate select for ${account.id}:`,
            result.error
          );
        }
      }
    },
    [openTabs, activeTabId]
  );

  const handleSwitchTab = useCallback(
    async (accountId) => {
      if (activeTabId === accountId) return;
      const result = await window.electronAPI.switchTab(accountId);
      if (result.success) {
        setActiveTabId(accountId);
      }
    },
    [activeTabId]
  );

  const handleCloseTab = useCallback(
    async (accountId) => {
      const remainingTabs = openTabs.filter((tab) => tab.id !== accountId);
      setOpenTabs(remainingTabs);
      if (activeTabId === accountId) {
        const newActiveId =
          remainingTabs.length > 0
            ? remainingTabs[remainingTabs.length - 1].id
            : null;
        if (newActiveId) {
          window.electronAPI.switchTab(newActiveId);
        } else {
          window.electronAPI.switchTab(null);
        }
      }
      const result = await window.electronAPI.closeTab(accountId);
      if (!result.success) {
        console.error(
          `Failed to close tab ${accountId} in main process:`,
          result.error
        );
      }
    },
    [activeTabId, openTabs]
  );

  const handleReorderTabs = useCallback(
    (fromId, toId) => {
      const fromIndex = openTabs.findIndex((tab) => tab.id === fromId);
      const toIndex = openTabs.findIndex((tab) => tab.id === toId);
      if (fromIndex === -1 || toIndex === -1) return;

      const updated = [...openTabs];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      setOpenTabs(updated);
    },
    [openTabs]
  );

  const handleGoHome = useCallback(async () => {
    console.log("Navigating back to initial screen...");
    setOpenTabs([]);
    setActiveTabId(null);
    setViewMode("initial");
    try {
      await window.electronAPI.resetToHome();
      console.log("Main process reset successful.");
    } catch (error) {
      console.error("Error calling resetToHome in main process:", error);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    console.log("Logging out user...");
    try {
      await window.electronAPI.googleLogout();
      console.log("Token successfully deleted from main process.");
    } catch (error) {
      console.error("Failed to delete token via main process:", error);
    }
    setUserInfo(null);
    setAccounts([]);
    setOpenTabs([]);
    setActiveTabId(null);
    setViewMode("login");
    window.electronAPI.resetToHome().catch((error) => {
      console.error("Error during logout reset:", error);
    });
  }, []);

  const handleSearchChange = useCallback((event) => {
    setSearchTerm(event.target.value);
  }, []);

  // Nová funkce pro zavolání refresh logiky
  // Uvnitř vaší komponenty App v App.jsx

  const handleRefresh = useCallback(async (accountId) => {
    if (!accountId) {
      console.log("No active tab to refresh.");
      return;
    }

    // Okamžitě nastavíme stav záložky na 'loading' pro rychlou vizuální odezvu
    setOpenTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === accountId ? { ...tab, status: "loading", error: null } : tab
      )
    );

    console.log(`Requesting refresh for tab: ${accountId}`);
    try {
      // Zavoláme hlavní proces, aby obnovil WebView
      await window.electronAPI.refreshActiveTab(accountId);
      // O zbytek (nastavení stavu na 'ready' nebo 'error') se postarají
      // listenery v main.js, které pošlou zprávu zpět.
    } catch (error) {
      console.error(`Failed to call refresh for tab ${accountId}:`, error);
      // Pokud selže samotné volání, nastavíme chybu
      setOpenTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === accountId
            ? { ...tab, status: "error", error: error.message }
            : tab
        )
      );
    }
  }, []); // Závislost je prázdná, protože setOpenTabs je stabilní

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
        // víc účtů pod jedním emailem -> skupina
        // reprezentant: první podle id vzestupně
        const representative = [...list].sort(
          (a, b) => Number(a.id) - Number(b.id)
        )[0];
        const tooltipNames = list
          .map(
            (a) =>
              `${a.name || `Účet ${a.id}`}${
                a.client_country ? ` (${a.client_country})` : ""
              }`
          )
          .join(", ");
        items.push({
          // pro výběr/id použijeme reprezentanta, aby se otevřel jen jeden
          id: representative.id,
          name: email, // v sidebaru zobrazíme e-mail
          client_country: representative.client_country,
          client_email: email,
          group: true,
          representative,
          groupAccounts: list,
          tooltip: tooltipNames,
        });
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
              onClick={handleDisabled}x
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

  return (
    <div className={`app-container-main ${isResizing ? "resizing" : ""}`}>
      <Sidebar
        accounts={displayAccounts}
        onSelect={handleSidebarSelect}
        width={sidebarWidth}
        isLoading={isLoadingAccounts}
        error={errorLoadingAccounts}
        searchTerm={searchTerm}
        onSearchChange={handleSearchChange}
        selectedAccountId={activeTabId}
        onGoHome={handleGoHome}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={handleToggleCollapse}
        onStartResize={handleStartResize}
        isResizing={isResizing}
        onRefresh={handleRefresh}
      />
      <div className={`main-content-wrapper ${isResizing ? "resizing" : ""}`}>
        <TabBar
          tabs={openTabs}
          activeTabId={activeTabId}
          onSwitchTab={handleSwitchTab}
          onCloseTab={handleCloseTab}
          height={TAB_BAR_HEIGHT}
          onReorderTabs={handleReorderTabs}
        />
        <ContentPlaceholder activeTab={activeTabInfo} />
      </div>
    </div>
  );
}

export default App;
