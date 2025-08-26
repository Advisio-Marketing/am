import React, { useState } from "react";
import PropTypes from "prop-types";
import "./SideBar.css";
import { FaHome, FaChevronLeft, FaChevronRight } from "react-icons/fa";
import { FaArrowsRotate } from "react-icons/fa6";

function Sidebar({
  accounts,
  onSelect,
  width,
  isLoading,
  error,
  searchTerm,
  onSearchChange,
  selectedAccountId,
  onGoHome,
  isCollapsed,
  onToggleCollapse,
  onStartResize,
  isResizing,
  onRefresh, // Přidána nová prop pro refresh
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefreshClick = () => {
    if (isRefreshing) return;

    setIsRefreshing(true);

    // Zavoláme funkci z App.js s ID aktivního tabu
    if (onRefresh) {
      onRefresh(selectedAccountId);
    }

    // Po 1 sekundě animaci zastavíme
    setTimeout(() => {
      setIsRefreshing(false);
    }, 1000);
  };

  if (isCollapsed) {
    return (
      <div className="sidebar sidebar-collapsed" style={{ width: '40px', minWidth: '40px' }}>
        <div className="sidebar-toggle-btn" onClick={onToggleCollapse}>
          <FaChevronRight title="Zobrazit boční panel" />
        </div>
        <div className="sidebar-resizer" onMouseDown={onStartResize}></div>
      </div>
    );
  }

  return (
    <div
      className="sidebar"
      style={{ width: `${width}px`, minWidth: `${width}px` }}
    >
      <div className="heading-box">
        <h2 className="sidebar-title">Účty</h2>
        <div className="sidebar-controls">
          <FaHome
            className="home-btn"
            onClick={onGoHome}
            title="Zpět na domovskou obrazovku"
          />
          <FaArrowsRotate
            className={`refresh-btn ${isRefreshing ? "spinning" : ""}`}
            title="Obnovit aktivní záložku"
            onClick={handleRefreshClick}
          />
          <FaChevronLeft
            className="sidebar-toggle-btn"
            onClick={onToggleCollapse}
            title="Skrýt boční panel"
          />
        </div>
      </div>

      <div className="sidebar-search-container">
        <input
          type="search"
          placeholder="Hledat účet..."
          className="sidebar-search-input"
          value={searchTerm}
          onChange={onSearchChange}
          disabled={isLoading || !!error}
        />
      </div>

      {isLoading && <p className="sidebar-loading">Načítám seznam...</p>}
      {error && <p className="sidebar-error">{error}</p>}

      {!isLoading && !error && (
        <ul className="sidebar-list">
          {accounts.length === 0 && searchTerm && (
            <li className="sidebar-empty">Žádné účty neodpovídají hledání.</li>
          )}
          {accounts.length === 0 && !searchTerm && (
            <li className="sidebar-empty">Nenalezeny žádné účty.</li>
          )}
          {accounts.map((item) => {
            const isSelected = item.group
              ? item.representative?.id === selectedAccountId
              : item.id === selectedAccountId;
            const title = item.group
              ? item.tooltip || item.name
              : `${item.name} - ${item.client_country}`;
            const label = item.group
              ? item.name
              : `${item.name} - ${item.client_country}`;
            const handleClick = () => {
              if (item.group && item.representative) {
                onSelect({
                  id: item.representative.id,
                  name: item.name, // v záložce zobrazíme e-mail
                  client_country: item.representative.client_country,
                  client_email: item.representative.client_email,
                  tabTitle: item.name,
                  tabTooltip: item.tooltip,
                });
              } else {
                onSelect(item);
              }
            };
            return (
              <li
                key={`${item.group ? `group-${item.name}` : item.id}`}
                className={`sidebar-item ${isSelected ? "selected-in-sidebar" : ""}`}
                onClick={handleClick}
                title={title}
              >
                <span className="sidebar-item-name">{label}</span>
              </li>
            );
          })}
        </ul>
      )}
      
      <div 
        className={`sidebar-resizer ${isResizing ? 'resizer-active' : ''}`}
        onMouseDown={onStartResize}
      ></div>
    </div>
  );
}

Sidebar.propTypes = {
  accounts: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
      client_country: PropTypes.string,
      client_email: PropTypes.string,
      group: PropTypes.bool,
      representative: PropTypes.shape({
        id: PropTypes.string,
        name: PropTypes.string,
        client_country: PropTypes.string,
        client_email: PropTypes.string,
      }),
      groupAccounts: PropTypes.array,
      tooltip: PropTypes.string,
    })
  ).isRequired,
  onSelect: PropTypes.func.isRequired,
  width: PropTypes.number.isRequired,
  isLoading: PropTypes.bool.isRequired,
  error: PropTypes.string,
  searchTerm: PropTypes.string.isRequired,
  onSearchChange: PropTypes.func.isRequired,
  selectedAccountId: PropTypes.string,
  onGoHome: PropTypes.func.isRequired,
  isCollapsed: PropTypes.bool.isRequired,
  onToggleCollapse: PropTypes.func.isRequired,
  onStartResize: PropTypes.func.isRequired,
  isResizing: PropTypes.bool.isRequired,
  onRefresh: PropTypes.func.isRequired, // Přidán propType pro onRefresh
};

export default Sidebar;
