import React from "react";
import PropTypes from "prop-types";
import styles from "./MessageModal.module.css";

function MessageModal({ title, message, details, onClose }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-label="Zavřít"
          className={styles.closeIcon}
          title="Zavřít"
          onClick={onClose}
        >
          &times;
        </button>
        {title ? <h3 className={styles.title}>{title}</h3> : null}
        <div className={styles.message}>{message}</div>
        {details ? <pre className={styles.details}>{details}</pre> : null}
        <div className={styles.actions}>
          <button className={styles.button} onClick={onClose}>
            Zavřít
          </button>
        </div>
      </div>
    </div>
  );
}

MessageModal.propTypes = {
  title: PropTypes.string,
  message: PropTypes.string.isRequired,
  details: PropTypes.string,
  onClose: PropTypes.func.isRequired,
};

MessageModal.defaultProps = {
  title: "",
  details: "",
};

export default MessageModal;
