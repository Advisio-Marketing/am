import React, { useState } from 'react';
import PropTypes from 'prop-types';
import TabBar from './TabBar';
import { FaHome, FaPlus } from 'react-icons/fa';
import { FaArrowsRotate } from 'react-icons/fa6';
import './GlobalTopBar.css';

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

  const handleRefreshClick = () => {
    if (isRefreshing || !activeTabId) return;
    setIsRefreshing(true);
    onRefresh(activeTabId);
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  return (
    <div className="global-top-bar">
      <div className="global-controls">
        <button onClick={onGoHome} title="Zpět na výběr aplikace">
          <FaHome />
        </button>
        <button onClick={handleRefreshClick} disabled={!activeTabId} title="Obnovit aktivní kartu">
          <FaArrowsRotate className={isRefreshing ? 'spinning' : ''} />
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
