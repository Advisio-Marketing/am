import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import PropTypes from "prop-types";
import styles from "./GoogleServicePickerModal.module.css";

const BASE = import.meta.env.BASE_URL;

function GoogleServicePickerModal({
  title,
  email,
  onPickAnalytics,
  onPickAds,
  onPickMerchant,
  onClose,
  onBack,
  disabledServices,
}) {
  const isAnalyticsDisabled = disabledServices.includes("analytics");
  const isAdsDisabled = disabledServices.includes("ads");
  const isMerchantDisabled = disabledServices.includes("merchant");

  const options = useMemo(
    () => [
      {
        key: "analytics",
        label: "Google Analytics",
        icon: "platform-google-analytics.svg",
        action: onPickAnalytics,
        disabled: isAnalyticsDisabled,
      },
      {
        key: "ads",
        label: "Google Ads",
        icon: "platform-google-ads.svg",
        action: onPickAds,
        disabled: isAdsDisabled,
      },
      {
        key: "merchant",
        label: "Google Merchant Center",
        icon: "platform-google-merchant.svg",
        action: onPickMerchant,
        disabled: isMerchantDisabled,
      },
    ],
    [
      onPickAnalytics,
      onPickAds,
      onPickMerchant,
      isAnalyticsDisabled,
      isAdsDisabled,
      isMerchantDisabled,
    ],
  );

  const enabledOptions = useMemo(
    () => options.filter((opt) => !opt.disabled),
    [options],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const buttonRefs = useRef([]);

  // Focus the selected button when selectedIndex changes
  useEffect(() => {
    const selectedOption = enabledOptions[selectedIndex];
    if (selectedOption) {
      const actualIndex = options.findIndex(
        (opt) => opt.key === selectedOption.key,
      );
      if (actualIndex >= 0) {
        buttonRefs.current[actualIndex]?.focus();
      }
    }
  }, [selectedIndex, enabledOptions, options]);

  const handleKeyDown = useCallback(
    (e) => {
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : enabledOptions.length - 1,
          );
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < enabledOptions.length - 1 ? prev + 1 : 0,
          );
          break;
        case "ArrowLeft":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : enabledOptions.length - 1,
          );
          break;
        case "ArrowRight":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < enabledOptions.length - 1 ? prev + 1 : 0,
          );
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (enabledOptions[selectedIndex]) {
            enabledOptions[selectedIndex].action();
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
    [selectedIndex, enabledOptions, onClose, onBack],
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
        {email ? <p className={styles.email}>{email}</p> : null}
        <div className={styles.list}>
          {options.map((opt, idx) => {
            const enabledIdx = enabledOptions.findIndex(
              (o) => o.key === opt.key,
            );
            const isSelected = enabledIdx === selectedIndex;
            return (
              <button
                key={opt.key}
                ref={(el) => (buttonRefs.current[idx] = el)}
                className={`${styles.serviceButton} ${isSelected && !opt.disabled ? styles.selected : ""}`}
                disabled={opt.disabled}
                onClick={() => !opt.disabled && opt.action()}
                onMouseEnter={() =>
                  !opt.disabled && setSelectedIndex(enabledIdx)
                }
                title={
                  opt.disabled ? "Zatím není dostupné" : `Otevřít ${opt.label}`
                }
                type="button"
                tabIndex={isSelected && !opt.disabled ? 0 : -1}
              >
                <img
                  src={`${BASE}img/platform/${opt.icon}`}
                  alt={opt.label}
                  className={styles.serviceIcon}
                />
                <span className={styles.serviceText}>{opt.label}</span>
                {opt.disabled ? (
                  <span className={styles.badgeDisabled}>nedostupné</span>
                ) : null}
              </button>
            );
          })}
        </div>
        {onBack && (
          <p className={styles.hint}>Backspace = zpět na výběr e-mailu</p>
        )}
      </div>
    </div>
  );
}

GoogleServicePickerModal.propTypes = {
  title: PropTypes.string,
  email: PropTypes.string,
  onPickAnalytics: PropTypes.func.isRequired,
  onPickAds: PropTypes.func.isRequired,
  onPickMerchant: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  onBack: PropTypes.func,
  disabledServices: PropTypes.arrayOf(PropTypes.string),
};

GoogleServicePickerModal.defaultProps = {
  title: "",
  email: "",
  disabledServices: [],
  onBack: null,
};

export default GoogleServicePickerModal;
