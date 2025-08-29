import React, { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import styles from "./TabBar.module.css";
import { FaHome, FaPlus } from "react-icons/fa";
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
}) {
  const dragTabId = useRef(null);
  const dragOrigin = useRef({ x: 0, y: 0 });
  const [isHoverReattach, setIsHoverReattach] = useState(false);
  const BASE = import.meta.env.BASE_URL; // <<< důležité pro dev/prod
  const api =
    typeof window !== "undefined" && window.electronAPI
      ? window.electronAPI
      : null;

  const handleDragStart = (e, tabId) => {
    dragTabId.current = tabId;
    e.dataTransfer.effectAllowed = "move";
    dragOrigin.current = { x: e.clientX, y: e.clientY };
  };

  const handleDragOver = (e, overTabId) => {
    e.preventDefault();
    if (dragTabId.current === overTabId) return;
  };

  const handleDrop = (e, dropTabId) => {
    e.preventDefault();
    const fromId = dragTabId.current;
    const toId = dropTabId;
    if (fromId && toId && fromId !== toId) {
      onReorderTabs(fromId, toId);
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
        <button
          className={styles["tab-ctrl-btn"]}
          onClick={onGoHome}
          title="Domů"
        >
          <FaHome />
        </button>
        <button
          className={styles["tab-ctrl-btn"]}
          onClick={() => onRefresh && onRefresh(activeTabId)}
          title="Obnovit aktivní záložku"
          disabled={
            !activeTabId ||
            tabs.find((t) => t.id === activeTabId)?.kind !== "account"
          }
        >
          <FaArrowsRotate className={styles["icon-rotate"]} />
        </button>
        <button
          className={styles["tab-ctrl-btn"]}
          onClick={() => onBack && onBack()}
          title="Zpět"
          disabled={
            !activeTabId ||
            tabs.find((t) => t.id === activeTabId)?.kind !== "account" ||
            !canGoBack
          }
        >
          <FaArrowRightToBracket className={styles["icon-back"]} />
        </button>
        <div className={styles["tab-ctrl-sep"]} />
        <button
          className={styles["tab-ctrl-btn"]}
          onClick={onNewHomeTab}
          title="Nová karta"
        >
          <FaPlus />
        </button>
      </div>
      <div className={styles["tab-scroll"]}>
        {tabs.map((tab) => {
          const logoSrc =
            tab.system === "heureka"
              ? `${BASE}img/platform/platform-heureka.svg`
              : tab.system === "mergado"
              ? `${BASE}img/platform/platform-mergado.svg`
              : null;

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
    })
  ).isRequired,
  activeTabId: PropTypes.string,
  onSwitchTab: PropTypes.func.isRequired,
  onCloseTab: PropTypes.func.isRequired,
  height: PropTypes.number.isRequired,
  onReorderTabs: PropTypes.func.isRequired,
  onGoHome: PropTypes.func.isRequired,
  onToggleCollapse: PropTypes.func.isRequired,
  isSidebarCollapsed: PropTypes.bool.isRequired,
  onRefresh: PropTypes.func.isRequired,
  onNewHomeTab: PropTypes.func.isRequired,
  onBack: PropTypes.func.isRequired,
  canGoBack: PropTypes.bool.isRequired,
  onDetachTab: PropTypes.func,
};

export default TabBar;
