import React, { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { FaTimes, FaChevronUp, FaChevronDown } from "react-icons/fa";
import styles from "./FindInPage.module.css";

function FindInPage({ tabId, onClose, focusTrigger }) {
  const [searchText, setSearchText] = useState("");
  const [matchInfo, setMatchInfo] = useState({ current: 0, total: 0 });
  const inputRef = useRef(null);
  const api =
    typeof window !== "undefined" && window.electronAPI
      ? window.electronAPI
      : null;

  // Show find bar on mount, hide on unmount
  useEffect(() => {
    api?.showFindBar?.();
    return () => {
      api?.hideFindBar?.();
    };
  }, [api]);

  // Focus input on mount and when focusTrigger changes
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusTrigger]);

  // Listen for find results from main process
  useEffect(() => {
    if (!api?.onFindInPageResult) return;
    const remove = api.onFindInPageResult(({ activeMatchOrdinal, matches }) => {
      setMatchInfo({ current: activeMatchOrdinal || 0, total: matches || 0 });
    });
    return () => remove?.();
  }, [api]);

  // Perform search when text changes
  useEffect(() => {
    if (!tabId) return;
    if (searchText.length > 0) {
      api?.findInPage?.(tabId, searchText);
    } else {
      api?.stopFindInPage?.(tabId);
      setMatchInfo({ current: 0, total: 0 });
    }
  }, [searchText, tabId, api]);

  // Stop find when component unmounts
  useEffect(() => {
    return () => {
      if (tabId) {
        api?.stopFindInPage?.(tabId);
      }
    };
  }, [tabId, api]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          api?.findInPagePrevious?.(tabId, searchText);
        } else {
          api?.findInPageNext?.(tabId, searchText);
        }
      }
    },
    [onClose, api, tabId, searchText],
  );

  const handlePrevious = () => {
    if (searchText.length > 0) {
      api?.findInPagePrevious?.(tabId, searchText);
    }
  };

  const handleNext = () => {
    if (searchText.length > 0) {
      api?.findInPageNext?.(tabId, searchText);
    }
  };

  return (
    <div className={styles.findBar}>
      <input
        ref={inputRef}
        type="text"
        className={styles.findInput}
        placeholder="Hledat na stránce..."
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className={styles.matchCount}>
        {searchText.length > 0 ? `${matchInfo.current}/${matchInfo.total}` : ""}
      </span>
      <button
        className={styles.findBtn}
        onClick={handlePrevious}
        disabled={matchInfo.total === 0}
        title="Předchozí (Shift+Enter)"
      >
        <FaChevronUp />
      </button>
      <button
        className={styles.findBtn}
        onClick={handleNext}
        disabled={matchInfo.total === 0}
        title="Další (Enter)"
      >
        <FaChevronDown />
      </button>
      <button
        className={styles.closeBtn}
        onClick={onClose}
        title="Zavřít (Esc)"
      >
        <FaTimes />
      </button>
    </div>
  );
}

FindInPage.propTypes = {
  tabId: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  focusTrigger: PropTypes.number,
};

FindInPage.defaultProps = {
  focusTrigger: 0,
};

export default FindInPage;
