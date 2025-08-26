import React, { useRef } from 'react';
import PropTypes from 'prop-types';
import './TabBar.css';

function TabBar({ tabs, activeTabId, onSwitchTab, onCloseTab, height, onReorderTabs }) {
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
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${tab.id === activeTabId ? 'active' : ''} status-${tab.status || 'ready'}`}
          onClick={() => tab.status !== 'loading' && onSwitchTab(tab.id)}
          onDragStart={(e) => handleDragStart(e, tab.id)}
          onDragOver={(e) => handleDragOver(e, tab.id)}
          onDrop={(e) => handleDrop(e, tab.id)}
          draggable
          title={tab.error ? `Chyba: ${tab.error}` : (tab.tooltip || tab.name)}
        >
          <span className="tab-item-name">{tab.title || tab.name}</span>
          {tab.status === 'loading' && <span className="tab-spinner" title="Načítání..."></span>}
          {tab.status === 'error' && <span className="tab-error-icon" title={`Chyba: ${tab.error}`}>⚠️</span>}
          <button
            className="close-tab-btn"
            onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
            title={`Zavřít ${tab.title || tab.name}`}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}

TabBar.propTypes = {
  tabs: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
  title: PropTypes.string,
  tooltip: PropTypes.string,
    status: PropTypes.oneOf(['loading', 'ready', 'error']).isRequired,
    error: PropTypes.string,
  })).isRequired,
  activeTabId: PropTypes.string,
  onSwitchTab: PropTypes.func.isRequired,
  onCloseTab: PropTypes.func.isRequired,
  height: PropTypes.number.isRequired,
  onReorderTabs: PropTypes.func.isRequired, // nová prop funkce
};

export default TabBar;
