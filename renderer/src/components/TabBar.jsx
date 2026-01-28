import React, { useEffect, useRef, useState, useCallback } from "react";
import PropTypes from "prop-types";
import styles from "./TabBar.module.css";
import {
  FaHome,
  FaPlus,
  FaLink,
  FaCheck,
  FaSearch,
  FaTimes,
  FaChevronUp,
  FaChevronDown,
} from "react-icons/fa";
import { FaArrowsRotate } from "react-icons/fa6";
import { FaArrowRightToBracket } from "react-icons/fa6";

function TabBar({
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  height,
  onReorderTabs,
  onGoHome,
  onToggleCollapse,
  isSidebarCollapsed,
  onRefresh,
  onNewHomeTab,
  onBack,
  canGoBack,
  onDetachTab,
  showFind,
  onToggleFind,
  findFocusTrigger,
  copyUrlTrigger,
  refreshTrigger,
}) {
  const dragTabId = useRef(null);
  const dragOrigin = useRef({ x: 0, y: 0 });
  const [isHoverReattach, setIsHoverReattach] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [matchInfo, setMatchInfo] = useState({ current: 0, total: 0 });
  const searchInputRef = useRef(null);
  const lastCopyUrlTrigger = useRef(0);
  const prevActiveTabRef = useRef(activeTabId);
  const BASE = import.meta.env.BASE_URL; // <<< důležité pro dev/prod
  const api =
    typeof window !== "undefined" && window.electronAPI
      ? window.electronAPI
      : null;

  // Detect platform for keyboard shortcut labels
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const mod = isMac ? "⌘" : "Ctrl";
  const alt = isMac ? "⌥" : "Alt";

  // Close find when tab changes
  useEffect(() => {
    if (prevActiveTabRef.current !== activeTabId && showFind) {
      onToggleFind?.(false);
    }
    prevActiveTabRef.current = activeTabId;
  }, [activeTabId, showFind, onToggleFind]);

  // Focus search input when find opens or focus trigger changes
  useEffect(() => {
    if (showFind && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
    if (!showFind) {
      setSearchText("");
      setMatchInfo({ current: 0, total: 0 });
      if (activeTabId) {
        api?.stopFindInPage?.(activeTabId);
      }
    }
  }, [showFind, activeTabId, api, findFocusTrigger]);

  // Handle copy URL trigger from keyboard shortcut
  useEffect(() => {
    // Only run if copyUrlTrigger actually changed (not just activeTabId)
    if (copyUrlTrigger === 0 || copyUrlTrigger === lastCopyUrlTrigger.current)
      return;
    lastCopyUrlTrigger.current = copyUrlTrigger;

    const doCopy = async () => {
      if (!activeTabId) return;
      try {
        const result = await api?.getCurrentTabUrl?.(activeTabId);
        if (result?.success && result.url) {
          await api?.copyToClipboard?.(result.url);
          setIsCopied(true);
          setTimeout(() => setIsCopied(false), 2000);
        }
      } catch (e) {
        console.error("Failed to copy URL:", e);
      }
    };
    doCopy();
  }, [copyUrlTrigger, activeTabId, api]);

  // Handle refresh trigger from keyboard shortcut
  useEffect(() => {
    if (refreshTrigger === 0) return; // Skip initial render
    if (!activeTabId) return;
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 1000);
  }, [refreshTrigger, activeTabId]);

  // Listen for find results
  useEffect(() => {
    if (!api?.onFindInPageResult) return;
    const remove = api.onFindInPageResult(({ activeMatchOrdinal, matches }) => {
      setMatchInfo({ current: activeMatchOrdinal || 0, total: matches || 0 });
    });
    return () => remove?.();
  }, [api]);

  // Perform search when text changes
  useEffect(() => {
    if (!activeTabId || !showFind) return;
    if (searchText.length > 0) {
      api?.findInPage?.(activeTabId, searchText);
    } else {
      api?.stopFindInPage?.(activeTabId);
      setMatchInfo({ current: 0, total: 0 });
    }
  }, [searchText, activeTabId, api, showFind]);

  const handleSearchKeyDown = useCallback(
    (e) => {
      if (e.key === "Escape") {
        onToggleFind?.(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          api?.findInPagePrevious?.(activeTabId, searchText);
        } else {
          api?.findInPageNext?.(activeTabId, searchText);
        }
      }
    },
    [onToggleFind, api, activeTabId, searchText],
  );

  const handleCopyUrl = async () => {
    if (!activeTabId || isCopied) return;
    try {
      const result = await api?.getCurrentTabUrl?.(activeTabId);
      if (result?.success && result.url) {
        await api?.copyToClipboard?.(result.url);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      }
    } catch (e) {
      console.error("Failed to copy URL:", e);
    }
  };

  const handleDragStart = (e, tabId) => {
    dragTabId.current = tabId;
    e.dataTransfer.effectAllowed = "move";
    dragOrigin.current = { x: e.clientX, y: e.clientY };
    try {
      // Enable cross-window DnD by carrying the tab id in the payload
      e.dataTransfer.setData("text/x-am-tab-id", String(tabId));
    } catch (_) {}
  };

  const handleDragOver = (e, overTabId) => {
    e.preventDefault();
    if (dragTabId.current === overTabId) return;
  };

  const handleDrop = (e, dropTabId) => {
    e.preventDefault();
    let fromId = dragTabId.current;
    if (!fromId) {
      // Cross-window: read from dataTransfer
      try {
        fromId = e.dataTransfer.getData("text/x-am-tab-id") || null;
      } catch (_) {}
    }
    const toId = dropTabId;
    if (!fromId) {
      dragTabId.current = null;
      return;
    }
    const fromExistsHere = !!tabs.find((t) => t.id === fromId);
    if (fromExistsHere) {
      if (toId && fromId !== toId) onReorderTabs(fromId, toId);
    } else {
      // Dropped a detached tab from another window onto this TabBar => attach here
      const api =
        typeof window !== "undefined" && window.electronAPI
          ? window.electronAPI
          : null;
      api?.attachDetachedTabHere?.(fromId);
    }
    dragTabId.current = null;
  };

  // When dragging ends anywhere, detect if dragged out of the TabBar to detach
  const handleDragEnd = async (e, tabId) => {
    try {
      // If more than 1 tab exists, allow detaching
      if (!tabs || tabs.length <= 1) return;
      const draggedTab = tabs.find((t) => t.id === tabId);
      if (!draggedTab || draggedTab.kind !== "account") return; // only native/account tabs are detachable
      const dx = Math.abs(e.clientX - dragOrigin.current.x);
      const dy = Math.abs(e.clientY - dragOrigin.current.y);
      const movedEnough = dx + dy > 10; // small threshold to avoid accidental
      if (!movedEnough) return;

      // If drag ends outside the TabBar area, request detach
      const bar = document.querySelector(`.${styles["tab-bar"]}`);
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (inside) return; // still inside, it's just a reorder

      // delegate detach to parent so state is updated consistently
      if (typeof onDetachTab === "function") {
        await onDetachTab(tabId);
      } else {
        await api?.detachTab?.(tabId);
      }
    } finally {
      dragTabId.current = null;
    }
  };

  // Listen to main-process hover notifications to toggle the reattach indicator
  useEffect(() => {
    if (!api?.onTabbarDetachHover) return;
    const remove = api.onTabbarDetachHover(({ hovering }) => {
      setIsHoverReattach(!!hovering);
    });
    return () => remove && remove();
  }, [api]);

  return (
    <div
      className={`${styles["tab-bar"]} ${
        isHoverReattach ? styles["reattach-hover"] : ""
      }`}
      style={{ height: `${height}px` }}
    >
      {isHoverReattach && (
        <svg
          className={styles.reattachOverlay}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {/* Full-bleed rectangle so stroke reaches the exact edges */}
          <rect
            x="0"
            y="0"
            width="100"
            height="100"
            className={styles.reattachRect}
          />
        </svg>
      )}
      <div className={styles["tab-controls"]}>
        {typeof onGoHome === "function" && (
          <button
            className={styles["tab-ctrl-btn"]}
            onClick={onGoHome}
            title={`Domů (${alt}+H)`}
          >
            <FaHome />
          </button>
        )}
        <button
          className={styles["tab-ctrl-btn"]}
          onClick={() => {
            if (onRefresh && activeTabId && !isRefreshing) {
              onRefresh(activeTabId);
              setIsRefreshing(true);
              setTimeout(() => setIsRefreshing(false), 1000);
            }
          }}
          title={`Obnovit aktivní záložku (${mod}+R)`}
          disabled={
            !activeTabId ||
            tabs.find((t) => t.id === activeTabId)?.kind !== "account"
          }
        >
          <FaArrowsRotate
            className={`${styles["icon-rotate"]} ${isRefreshing ? styles.spinning : ""}`}
          />
        </button>
        <button
          className={styles["tab-ctrl-btn"]}
          onClick={() => onBack && onBack()}
          title={`Zpět (${mod}+Backspace)`}
          disabled={
            !activeTabId ||
            tabs.find((t) => t.id === activeTabId)?.kind !== "account" ||
            !canGoBack
          }
        >
          <FaArrowRightToBracket className={styles["icon-back"]} />
        </button>
        <button
          className={styles["tab-ctrl-btn"]}
          onClick={handleCopyUrl}
          title={`Kopírovat URL (${mod}+Shift+C)`}
          disabled={
            !activeTabId ||
            tabs.find((t) => t.id === activeTabId)?.kind !== "account"
          }
        >
          {isCopied ? <FaCheck /> : <FaLink />}
        </button>
        <button
          className={styles["tab-ctrl-btn"]}
          onClick={() => onToggleFind?.(!showFind)}
          title={`Hledat na stránce (${mod}+F)`}
          disabled={
            !activeTabId ||
            tabs.find((t) => t.id === activeTabId)?.kind !== "account"
          }
        >
          <FaSearch />
        </button>
        {/* Find in page - animated input */}
        <div
          className={`${styles["find-container"]} ${showFind ? styles["find-open"] : ""}`}
        >
          <input
            ref={searchInputRef}
            type="text"
            className={styles["find-input"]}
            placeholder="Hledat..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <span className={styles["find-count"]}>
            {searchText.length > 0
              ? `${matchInfo.current}/${matchInfo.total}`
              : ""}
          </span>
          <button
            className={styles["find-nav-btn"]}
            onClick={() => api?.findInPagePrevious?.(activeTabId, searchText)}
            disabled={matchInfo.total === 0}
            title="Předchozí (Shift+Enter)"
          >
            <FaChevronUp />
          </button>
          <button
            className={styles["find-nav-btn"]}
            onClick={() => api?.findInPageNext?.(activeTabId, searchText)}
            disabled={matchInfo.total === 0}
            title="Další (Enter)"
          >
            <FaChevronDown />
          </button>
          <button
            className={styles["find-close-btn"]}
            onClick={() => onToggleFind?.(false)}
            title="Zavřít (Esc)"
          >
            <FaTimes />
          </button>
        </div>
        <div className={styles["tab-ctrl-sep"]} />
        {typeof onNewHomeTab === "function" && (
          <button
            className={styles["tab-ctrl-btn"]}
            onClick={onNewHomeTab}
            title={`Nová karta (${mod}+T)`}
          >
            <FaPlus />
          </button>
        )}
      </div>
      <div
        className={styles["tab-scroll"]}
        onDragOver={(e) => {
          // allow drop anywhere in tab strip for cross-window attach
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          let fromId = null;
          try {
            fromId = e.dataTransfer.getData("text/x-am-tab-id") || null;
          } catch (_) {}
          if (!fromId) return;
          const fromExistsHere = !!tabs.find((t) => t.id === fromId);
          if (!fromExistsHere) {
            const api =
              typeof window !== "undefined" && window.electronAPI
                ? window.electronAPI
                : null;
            api?.attachDetachedTabHere?.(fromId);
          }
        }}
      >
        {tabs.map((tab) => {
          let logoSrc = null;
          if (tab.system === "heureka") {
            logoSrc = `${BASE}img/platform/platform-heureka.svg`;
          } else if (tab.system === "mergado") {
            logoSrc = `${BASE}img/platform/platform-mergado.svg`;
          } else if (tab.system === "google") {
            if (tab.service === "analytics") {
              logoSrc = `${BASE}img/platform/platform-google-analytics.svg`;
            } else if (tab.service === "ads") {
              logoSrc = `${BASE}img/platform/platform-google-ads.svg`;
            } else if (tab.service === "merchant") {
              logoSrc = `${BASE}img/platform/platform-google-merchant.svg`;
            }
          }

          return (
            <div
              key={tab.id}
              className={`${styles["tab-item"]} ${
                tab.id === activeTabId ? styles["active"] : ""
              }`}
              onClick={() => onSwitchTab(tab.id)}
              onContextMenu={(e) => {
                if (tab.kind !== "account") return;
                e.preventDefault();
                api?.showTabContextMenu?.(tab.id);
              }}
              onDragStart={(e) => handleDragStart(e, tab.id)}
              onDragOver={(e) => handleDragOver(e, tab.id)}
              onDrop={(e) => handleDrop(e, tab.id)}
              draggable
              onDragEnd={(e) => handleDragEnd(e, tab.id)}
              title={tab.tooltip || tab.title || tab.name}
            >
              {logoSrc && (
                <img
                  src={logoSrc}
                  alt={tab.system || "system"}
                  className={styles["tab-item-logo"]}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
              <span className={styles["tab-item-name"]}>
                {tab.title || tab.name}
              </span>
              <button
                className={styles["close-tab-btn"]}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                title={`Zavřít ${tab.title || tab.name}`}
              >
                &times;
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

TabBar.propTypes = {
  tabs: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
      title: PropTypes.string,
      tooltip: PropTypes.string,
      status: PropTypes.oneOf(["loading", "ready", "error"]).isRequired,
      error: PropTypes.string,
      kind: PropTypes.oneOf(["account", "home", "hub"]),
    }),
  ).isRequired,
  activeTabId: PropTypes.string,
  onSwitchTab: PropTypes.func.isRequired,
  onCloseTab: PropTypes.func.isRequired,
  height: PropTypes.number.isRequired,
  onReorderTabs: PropTypes.func.isRequired,
  onGoHome: PropTypes.func,
  onToggleCollapse: PropTypes.func.isRequired,
  isSidebarCollapsed: PropTypes.bool.isRequired,
  onRefresh: PropTypes.func.isRequired,
  onNewHomeTab: PropTypes.func,
  onBack: PropTypes.func.isRequired,
  canGoBack: PropTypes.bool.isRequired,
  onDetachTab: PropTypes.func,
  showFind: PropTypes.bool,
  onToggleFind: PropTypes.func,
  findFocusTrigger: PropTypes.number,
  copyUrlTrigger: PropTypes.number,
  refreshTrigger: PropTypes.number,
};

export default TabBar;
