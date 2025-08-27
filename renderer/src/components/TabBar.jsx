import React, { useRef } from "react";
import PropTypes from "prop-types";
import "./TabBar.css";
import { FaHome, FaPlus } from "react-icons/fa";
import { FaArrowsRotate } from "react-icons/fa6";

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
}) {
  const dragTabId = useRef(null);

  const handleDragStart = (e, tabId) => {
    dragTabId.current = tabId;
    e.dataTransfer.effectAllowed = "move";
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

  return (
    <div className="tab-bar" style={{ height: `${height}px` }}>
      <div className="tab-controls">
        <button className="tab-ctrl-btn" onClick={onGoHome} title="Domů">
          <FaHome />
        </button>
        <button
          className="tab-ctrl-btn"
          onClick={() => onRefresh && onRefresh(activeTabId)}
          title="Obnovit aktivní záložku"
          disabled={
            !activeTabId ||
            tabs.find((t) => t.id === activeTabId)?.kind !== "account"
          }
        >
          <FaArrowsRotate className="icon-rotate" />
        </button>
        {/* Sidebar toggle moved into Sidebar header */}
        <div className="tab-ctrl-sep" />
        <button
          className="tab-ctrl-btn"
          onClick={onNewHomeTab}
          title="Nová karta"
        >
          <FaPlus />
        </button>
      </div>
      <div className="tab-scroll">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab-item ${tab.id === activeTabId ? "active" : ""}`}
            onClick={() => onSwitchTab(tab.id)}
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragOver={(e) => handleDragOver(e, tab.id)}
            onDrop={(e) => handleDrop(e, tab.id)}
            draggable
            title={tab.tooltip || tab.title || tab.name}
          >
            {(() => {
              const logoSrc =
                tab.system === "heureka"
                  ? "/img/platform/platform-heureka.svg"
                  : tab.system === "mergado"
                  ? "/img/platform/platform-mergado.svg"
                  : null;
              return logoSrc ? (
                <img
                  src={logoSrc}
                  alt={tab.system || "system"}
                  className="tab-item-logo"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : null;
            })()}
            <span className="tab-item-name">{tab.title || tab.name}</span>
            <button
              className="close-tab-btn"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              title={`Zavřít ${tab.title || tab.name}`}
            >
              &times;
            </button>
          </div>
        ))}
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
  onReorderTabs: PropTypes.func.isRequired, // nová prop funkce
  onGoHome: PropTypes.func.isRequired,
  onToggleCollapse: PropTypes.func.isRequired,
  isSidebarCollapsed: PropTypes.bool.isRequired,
  onRefresh: PropTypes.func.isRequired,
  onNewHomeTab: PropTypes.func.isRequired,
};

export default TabBar;
