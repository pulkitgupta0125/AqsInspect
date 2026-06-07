import React, { useMemo } from "react";

export default function AIInsightsPanel({ findings = [], onFilterChange }) {
  const insights = useMemo(() => {
    let high = 0, medium = 0, low = 0;
    const issues = [];

    (findings || []).forEach((item) => {
      const severityRaw = String(item.severity || "info").toLowerCase();
      const severity =
        severityRaw === "blocker" ? "HIGH" : severityRaw === "major" ? "MEDIUM" : "LOW";

      if (severity === "HIGH") high++;
      else if (severity === "MEDIUM") medium++;
      else low++;

      issues.push({
        message: item.explanation || item.title || "Review finding",
        severity,
        confidence: item.confidence ?? 0,
        file: item.filename || "Unknown",
        title: item.title || "Finding",
      });
    });

    const score = Math.max(0, 100 - (high * 40 + medium * 15 + low * 5));
    return { high, medium, low, issues, score };
  }, [findings]);

  const scoreColor =
    insights.score >= 80 ? "#3fb950" : insights.score >= 50 ? "#e3b341" : "#f85149";

  const circumference = 2 * Math.PI * 22;
  const dashOffset = circumference * (1 - insights.score / 100);

  return (
    <div style={styles.container}>
      {/* Header row: score ring + label */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.title}>AI Insights</div>
          <div style={styles.subtitle}>
            {insights.high > 0
              ? "Critical issues found. Prioritize these files."
              : insights.medium > 0
              ? "Moderate issues. Review for risk."
              : "No high-risk issues detected."}
          </div>
        </div>
        <div style={styles.ring}>
          <svg width="56" height="56" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="22" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
            <circle
              cx="28" cy="28" r="22"
              fill="none"
              stroke={scoreColor}
              strokeWidth="5"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 28 28)"
              style={{ transition: "stroke-dashoffset 0.6s ease, stroke 0.4s ease" }}
            />
          </svg>
          <div style={{ ...styles.ringLabel, color: scoreColor }}>{insights.score}</div>
        </div>
      </div>

      {/* KPI row */}
      <div style={styles.kpiRow}>
        <KPI label="Blocker" value={insights.high} color="#f85149" bg="rgba(248,81,73,0.10)" onClick={() => onFilterChange?.("HIGH")} />
        <KPI label="Major" value={insights.medium} color="#e3b341" bg="rgba(227,179,65,0.10)" onClick={() => onFilterChange?.("MEDIUM")} />
        <KPI label="Minor" value={insights.low} color="#58a6ff" bg="rgba(88,166,255,0.10)" onClick={() => onFilterChange?.("LOW")} />
      </div>

      {/* Top findings */}
      {insights.issues.length > 0 && (
        <div style={styles.findings}>
          <div style={styles.findingsTitle}>Top Findings</div>
          {insights.issues.slice(0, 4).map((issue, idx) => (
            <div key={idx} style={styles.findingItem}>
              <div style={styles.findingHeader}>
                <span style={{ ...styles.badge, background: severityBg(issue.severity), color: severityColor(issue.severity), border: `1px solid ${severityBorder(issue.severity)}` }}>
                  {issue.severity}
                </span>
                <span style={styles.findingFile}>{baseName(issue.file)}</span>
                <span style={styles.confidence}>
                  {typeof issue.confidence === "number" ? `${Math.round(issue.confidence * 100)}%` : "—"}
                </span>
              </div>
              <div style={styles.findingText}>{issue.title}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KPI({ label, value, color, bg, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{ ...styles.kpiCard, background: bg, borderColor: `${color}30` }}
    >
      <div style={{ ...styles.kpiValue, color }}>{value}</div>
      <div style={styles.kpiLabel}>{label}</div>
    </button>
  );
}

function baseName(p) {
  if (!p) return "";
  return p.split(/[\\/]/).pop() || p;
}

function severityColor(s) {
  if (s === "HIGH") return "#f85149";
  if (s === "MEDIUM") return "#e3b341";
  return "#58a6ff";
}

function severityBg(s) {
  if (s === "HIGH") return "rgba(248,81,73,0.12)";
  if (s === "MEDIUM") return "rgba(227,179,65,0.12)";
  return "rgba(88,166,255,0.10)";
}

function severityBorder(s) {
  if (s === "HIGH") return "rgba(248,81,73,0.30)";
  if (s === "MEDIUM") return "rgba(227,179,65,0.28)";
  return "rgba(88,166,255,0.28)";
}

const styles = {
  container: {
    background: "#1c2333",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 14,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  headerLeft: { flex: 1, minWidth: 0 },
  title: { fontWeight: 800, fontSize: 13.5, color: "#e6edf3", lineHeight: 1.3 },
  subtitle: { fontSize: 11.5, color: "#8b949e", lineHeight: 1.5, marginTop: 3 },
  ring: {
    position: "relative",
    width: 56,
    height: 56,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  ringLabel: {
    position: "absolute",
    fontSize: 14,
    fontWeight: 900,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1,
  },
  kpiRow: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 },
  kpiCard: {
    padding: "10px 8px",
    textAlign: "center",
    borderRadius: 10,
    cursor: "pointer",
    border: "1px solid transparent",
    transition: "all 0.15s ease",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    alignItems: "center",
  },
  kpiValue: { fontSize: 18, fontWeight: 900, lineHeight: 1 },
  kpiLabel: { fontSize: 10.5, color: "#8b949e", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.3px" },
  findings: { display: "flex", flexDirection: "column", gap: 8 },
  findingsTitle: {
    fontSize: 10.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.7px",
    color: "#6e7681",
    marginBottom: 2,
  },
  findingItem: {
    padding: "10px 12px",
    background: "#161c27",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.05)",
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  findingHeader: {
    display: "flex",
    gap: 7,
    alignItems: "center",
    flexWrap: "wrap",
  },
  badge: {
    fontSize: 9.5,
    fontWeight: 800,
    padding: "2px 7px",
    borderRadius: 999,
    textTransform: "uppercase",
    letterSpacing: "0.4px",
    whiteSpace: "nowrap",
  },
  findingFile: {
    fontSize: 10.5,
    color: "#6e7681",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: "JetBrains Mono, Consolas, monospace",
  },
  confidence: { fontSize: 10.5, color: "#6e7681" },
  findingText: { fontSize: 12, color: "#c9d1d9", lineHeight: 1.5 },
};
