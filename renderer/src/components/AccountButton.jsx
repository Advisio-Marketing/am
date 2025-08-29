// src/renderer/src/components/AccountButton.jsx
import React from "react";
import PropTypes from "prop-types";
import styles from "./AccountButton.module.css";

function AccountButton({ accountName, onClick, disabled, loading }) {
  return (
    <button
      className={styles["account-button"]}
      onClick={() => !disabled && onClick(accountName)}
      disabled={disabled}
    >
      {loading ? "Načítám..." : accountName}
    </button>
  );
}

AccountButton.propTypes = {
  accountName: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  loading: PropTypes.bool,
};

AccountButton.defaultProps = {
  disabled: false,
  loading: false,
};

export default AccountButton;
