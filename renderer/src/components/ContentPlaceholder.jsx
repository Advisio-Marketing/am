// src/renderer/src/components/ContentPlaceholder.jsx
import React from "react";
import PropTypes from "prop-types";
import styles from "./ContentPlaceholder.module.css";

function ContentPlaceholder({ activeTab }) {
  let message = "Vyberte nebo otevřete účet ze seznamu vlevo.";
  let statusClass = "idle";

  if (activeTab) {
    statusClass = `status-${activeTab.status}`;
    switch (activeTab.status) {
      case "loading":
        message = `Načítám ${activeTab.name}...`;
        break;
      case "error":
        message = `Chyba při načítání ${activeTab.name}:\n${
          activeTab.error || "Neznámá chyba"
        }`;
        break;
      case "ready":
        return null; // Nezobrazovat nic, když je tab ready
      default:
        message = `Neznámý stav (${activeTab.status}) pro ${activeTab.name}.`;
    }
  }

  // Zobrazíme placeholder jen pokud NENÍ žádný aktivní tab,
  // NEBO pokud aktivní tab má chybu nebo se načítá
  if (
    !activeTab ||
    activeTab.status === "loading" ||
    activeTab.status === "error"
  ) {
    return (
      <div
        className={`${styles["content-placeholder"]} ${
          styles[statusClass] || ""
        }`}
      >
        {message}
      </div>
    );
  }

  return null; // V ostatních případech (ready) nic nezobrazíme
}

ContentPlaceholder.propTypes = {
  activeTab: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    status: PropTypes.string,
    error: PropTypes.string,
  }),
};

export default ContentPlaceholder;
