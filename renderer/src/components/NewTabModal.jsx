import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import PropTypes from "prop-types";
import styles from "./NewTabModal.module.css";

const BASE = import.meta.env.BASE_URL;

// Minimal inline-styled modal to pick a system for a new tab
function NewTabModal({ onClose, onPickHeureka, onPickMergado, onPickGoogle }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const options = useMemo(
    () => [
      {
        key: "heureka",
        label: "Heureka",
        icon: "platform-heureka.svg",
        action: onPickHeureka,
      },
      {
        key: "mergado",
        label: "Mergado",
        icon: "platform-mergado.svg",
        action: onPickMergado,
      },
      {
        key: "google",
        label: "Google",
        icon: "google-logo.svg",
        action: onPickGoogle,
      },
    ],
    [onPickHeureka, onPickMergado, onPickGoogle],
  );
  const buttonRefs = useRef([]);

  // Focus the selected button when selectedIndex changes
  useEffect(() => {
    buttonRefs.current[selectedIndex]?.focus();
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e) => {
      switch (e.key) {
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : options.length - 1,
          );
          break;
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < options.length - 1 ? prev + 1 : 0,
          );
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          options[selectedIndex].action();
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        default:
          break;
      }
    },
    [selectedIndex, options, onClose],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Update selected index on mouse enter
  const handleMouseEnter = (idx) => {
    setSelectedIndex(idx);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-label="Zavřít"
          className={styles.closeIcon}
          title="Zavřít (Esc)"
          onClick={onClose}
        >
          &times;
        </button>
        <h3 className={styles.title}>Vyber systém</h3>
        <div className={styles.list}>
          {options.map((opt, idx) => (
            <button
              key={opt.key}
              ref={(el) => (buttonRefs.current[idx] = el)}
              className={`${styles.serviceButton} ${idx === selectedIndex ? styles.selected : ""}`}
              onClick={opt.action}
              onMouseEnter={() => handleMouseEnter(idx)}
              title={opt.label}
              tabIndex={idx === selectedIndex ? 0 : -1}
              type="button"
            >
              <img
                src={`${BASE}img/platform/${opt.icon}`}
                alt={opt.label}
                className={styles.serviceIcon}
              />
              <span className={styles.serviceText}>{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

NewTabModal.propTypes = {
  onClose: PropTypes.func.isRequired,
  onPickHeureka: PropTypes.func.isRequired,
  onPickMergado: PropTypes.func.isRequired,
  onPickGoogle: PropTypes.func.isRequired,
};

export default NewTabModal;
