import React from "react";
import PropTypes from "prop-types";
import styles from "./NewTabModal.module.css";

// Minimal inline-styled modal to pick a system for a new tab
function NewTabModal({ onClose, onPickHeureka, onPickMergado }) {
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
        {/* <p className={styles.description}>
          Vyberte systém, který chcete otevřít v nové záložce:
        </p> */}
        <div className={styles.buttonsRow}>
          <button
            className={styles.button}
            onClick={onPickHeureka}
            title="Heureka účty"
          >
            Heureka
          </button>
          <button
            className={styles.button}
            onClick={onPickMergado}
            title="Mergado"
          >
            Mergado
          </button>
        </div>
      </div>
    </div>
  );
}

NewTabModal.propTypes = {
  onClose: PropTypes.func.isRequired,
  onPickHeureka: PropTypes.func.isRequired,
  onPickMergado: PropTypes.func.isRequired,
};

export default NewTabModal;
