import React, { useState } from "react";
import PropTypes from "prop-types";
import TabBar from "./TabBar";
import { FaHome, FaPlus, FaCheck, FaCopy } from "react-icons/fa";
import { FaArrowsRotate } from "react-icons/fa6";
import styles from "./GlobalTopBar.module.css";

const GlobalTopBar = ({
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onReorderTabs,
  onGoHome,
  onRefresh,
  onNewTab,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const api =
    typeof window !== "undefined" && window.electronAPI
      ? window.electronAPI
      : null;

  const handleRefreshClick = () => {
    if (isRefreshing || !activeTabId) return;
    setIsRefreshing(true);
    onRefresh(activeTabId);
    setTimeout(() => setIsRefreshing(false), 1000);
  };

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

  return (
    <div className={styles["global-top-bar"]}>
      <div className={styles["global-controls"]}>
        <button onClick={onGoHome} title="Zpět na výběr aplikace">
          <FaHome />
        </button>
        <button
          onClick={handleRefreshClick}
          disabled={!activeTabId}
          title="Obnovit aktivní kartu"
        >
          <FaArrowsRotate className={isRefreshing ? styles.spinning : ""} />
        </button>
        <button
          onClick={handleCopyUrl}
          disabled={!activeTabId}
          title="Kopírovat URL aktivní karty"
        >
          {isCopied ? <FaCheck /> : <FaCopy />}
        </button>
        <button onClick={onNewTab} title="Nová karta">
          <FaPlus />
        </button>
      </div>
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitchTab={onSwitchTab}
        onCloseTab={onCloseTab}
        onReorderTabs={onReorderTabs}
      />
    </div>
  );
};

GlobalTopBar.propTypes = {
  tabs: PropTypes.array.isRequired,
  activeTabId: PropTypes.string,
  onSwitchTab: PropTypes.func.isRequired,
  onCloseTab: PropTypes.func.isRequired,
  onReorderTabs: PropTypes.func.isRequired,
  onGoHome: PropTypes.func.isRequired,
  onRefresh: PropTypes.func.isRequired,
  onNewTab: PropTypes.func.isRequired,
};

export default GlobalTopBar;
