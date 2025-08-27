import React from "react";
import PropTypes from "prop-types";

function HomeTab({ userInfo, onHeureka, onMergado, isLoading }) {
  return (
    <div style={{ padding: 16 }}>
      {userInfo && (
        <div style={{ marginBottom: 12, color: "#495057" }}>
          Přihlášen: {userInfo.name} ({userInfo.email})
        </div>
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          onClick={onHeureka}
          disabled={isLoading}
          title="Otevřít Heureka účty"
          style={btnStyle}
        >
          Heureka
        </button>
        <button
          onClick={onMergado}
          disabled={isLoading}
          title="Otevřít Mergado"
          style={btnStyle}
        >
          Mergado
        </button>
      </div>
    </div>
  );
}

const btnStyle = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #ced4da",
  background: "#f8f9fa",
  color: "#212529",
  cursor: "pointer",
};

HomeTab.propTypes = {
  userInfo: PropTypes.object,
  onHeureka: PropTypes.func.isRequired,
  onMergado: PropTypes.func.isRequired,
  isLoading: PropTypes.bool,
};

export default HomeTab;
