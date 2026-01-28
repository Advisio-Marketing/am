import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import PropTypes from "prop-types";
import styles from "./EmailPickerModal.module.css";

function EmailPickerModal({
  title,
  emails,
  disabledEmails,
  onPick,
  onClose,
  onBack,
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const buttonRefs = useRef([]);

  // Get only enabled emails for navigation - memoized to avoid stale closures
  const enabledEmails = useMemo(
    () => emails.filter((email) => !disabledEmails.includes(email)),
    [emails, disabledEmails],
  );

  // Focus the selected button when selectedIndex changes
  useEffect(() => {
    const selectedEmail = enabledEmails[selectedIndex];
    if (selectedEmail) {
      const actualIndex = emails.indexOf(selectedEmail);
      if (actualIndex >= 0) {
        buttonRefs.current[actualIndex]?.focus();
      }
    }
  }, [selectedIndex, enabledEmails, emails]);

  const handleKeyDown = useCallback(
    (e) => {
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : enabledEmails.length - 1,
          );
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < enabledEmails.length - 1 ? prev + 1 : 0,
          );
          break;
        case "ArrowLeft":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : enabledEmails.length - 1,
          );
          break;
        case "ArrowRight":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < enabledEmails.length - 1 ? prev + 1 : 0,
          );
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (enabledEmails[selectedIndex]) {
            onPick(enabledEmails[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "Backspace":
          e.preventDefault();
          if (onBack) {
            onBack();
          } else {
            onClose();
          }
          break;
        default:
          break;
      }
    },
    [selectedIndex, enabledEmails, onPick, onClose, onBack],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

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
        {title ? <h3 className={styles.title}>{title}</h3> : null}
        <div className={styles.list}>
          {emails.map((email, idx) => {
            const isDisabled = disabledEmails.includes(email);
            const enabledIdx = enabledEmails.indexOf(email);
            const isSelected = enabledIdx === selectedIndex;
            return (
              <button
                key={email}
                ref={(el) => (buttonRefs.current[idx] = el)}
                className={`${styles.emailButton} ${isSelected && !isDisabled ? styles.selected : ""}`}
                disabled={isDisabled}
                onClick={() => !isDisabled && onPick(email)}
                onMouseEnter={() => !isDisabled && setSelectedIndex(enabledIdx)}
                title={
                  isDisabled
                    ? "Zatím není dostupné"
                    : `Použít ${email} pro request`
                }
                type="button"
                tabIndex={isSelected && !isDisabled ? 0 : -1}
              >
                <span className={styles.emailText}>{email}</span>
                {isDisabled ? (
                  <span className={styles.badgeDisabled}>nedostupné</span>
                ) : null}
              </button>
            );
          })}
        </div>
        {onBack && <p className={styles.hint}>Backspace = zpět</p>}
      </div>
    </div>
  );
}

EmailPickerModal.propTypes = {
  title: PropTypes.string,
  emails: PropTypes.arrayOf(PropTypes.string).isRequired,
  disabledEmails: PropTypes.arrayOf(PropTypes.string),
  onPick: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  onBack: PropTypes.func,
};

EmailPickerModal.defaultProps = {
  title: "",
  disabledEmails: [],
  onBack: null,
};

export default EmailPickerModal;
