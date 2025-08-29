import React from "react";
import PropTypes from "prop-types";
import styles from "./StyledButton.module.css";

function StyledButton({
  children,
  onClick,
  disabled = false,
  loading = false,
  variant = "primary",
  ...props
}) {
  return (
    <button
      className={`${styles["styled-button"]} ${
        styles[`styled-button--${variant}`]
      } ${loading ? styles["loading"] : ""}`}
      onClick={onClick}
      disabled={disabled || loading}
      {...props}
    >
      {children}
    </button>
  );
}

StyledButton.propTypes = {
  children: PropTypes.node.isRequired,
  onClick: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  loading: PropTypes.bool,
  variant: PropTypes.oneOf(["primary", "danger"]),
};

export default StyledButton;
