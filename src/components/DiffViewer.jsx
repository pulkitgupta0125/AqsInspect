import React, { useEffect, useMemo, useRef, useState } from "react";

const COLLAPSE_THRESHOLD = 14;
const KEEP_HEAD = 3;
const KEEP_TAIL = 3;

const isLargeOmitted = (patch = "") => {
  const p = String(patch || "");
  return (
    !p.trim() ||
    p.includes("[Large file diff omitted by AQS Inspect]") ||
    p.toLowerCase().includes("large file diff omitted")
  );
};

function parseHunkHeader(headerLine) {
  const m = headerLine.match(/@@\s+\-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!m) return { oldStart: 1, newStart: 1 };
  return { oldStart: Number(m[1]), newStart: Number(m[3]) };
}

function splitIntoHunksUnified(patch) {
  const lines = String(patch || "").split("\n");
  const hunks = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (current) hunks.push(current);
      current = { header: line, lines: [] };
    } else {
      if (!current) current = { header: "(file header)", lines: [] };
      current.lines.push(line);
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

function buildSplitRowsFromHunk(hunkHeader, hunkLines) {
  const { oldStart, newStart } = parseHunkHeader(hunkHeader);
  let oldNo = oldStart;
  let newNo = newStart;

  const rows = [];
  let delBuf = [];
  let addBuf = [];

  const flush = () => {
    const pairCount = Math.min(delBuf.length, addBuf.length);

    for (let i = 0; i < pairCount; i++) {
      rows.push({
        kind: "mod",
        left: delBuf[i].text,
        right: addBuf[i].text,
        oldNo: delBuf[i].no,
        newNo: addBuf[i].no,
      });
    }

    for (let i = pairCount; i < delBuf.length; i++) {
      rows.push({ kind: "del", left: delBuf[i].text, right: "", oldNo: delBuf[i].no, newNo: null });
    }

    for (let i = pairCount; i < addBuf.length; i++) {
      rows.push({ kind: "add", left: "", right: addBuf[i].text, oldNo: null, newNo: addBuf[i].no });
    }

    delBuf = [];
    addBuf = [];
  };

  const markNoNewline = () => {
    const last = rows[rows.length - 1];
    if (last) last.noNewline = true;
  };

  for (const line of hunkLines) {
    if (line.startsWith("\\ No newline at end of file")) {
      flush();
      markNoNewline();
      continue;
    }

    const prefix = line[0];

    if (prefix === "-") {
      delBuf.push({ text: line, no: oldNo++ });
      continue;
    }

    if (prefix === "+") {
      addBuf.push({ text: line, no: newNo++ });
      continue;
    }

    flush();

    if (prefix === " ") {
      rows.push({ kind: "ctx", left: line, right: line, oldNo, newNo });
      oldNo += 1;
      newNo += 1;
    } else {
      rows.push({ kind: "ctx", left: line, right: line, oldNo: null, newNo: null });
    }
  }

  flush();
  return rows;
}

function buildSmartCollapsedItems(rows, hunkIndex, expandedFolds) {
  const items = [];
  let i = 0;

  while (i < rows.length) {
    const r = rows[i];

    if (r.kind !== "ctx") {
      items.push({ type: "row", row: r });
      i++;
      continue;
    }

    let j = i;
    while (j < rows.length && rows[j].kind === "ctx") j++;
    const runLen = j - i;

    if (runLen <= COLLAPSE_THRESHOLD) {
      for (let k = i; k < j; k++) items.push({ type: "row", row: rows[k] });
    } else {
      const foldId = `${hunkIndex}-${i}-${j - 1}`;
      const expanded = expandedFolds.has(foldId);

      if (expanded) {
        for (let k = i; k < j; k++) items.push({ type: "row", row: rows[k] });
      } else {
        for (let k = i; k < i + KEEP_HEAD; k++) items.push({ type: "row", row: rows[k] });
        items.push({ type: "fold", foldId, count: runLen - KEEP_HEAD - KEEP_TAIL });
        for (let k = j - KEEP_TAIL; k < j; k++) items.push({ type: "row", row: rows[k] });
      }
    }

    i = j;
  }

  return items;
}

function extractAddedFileContentFromPatch(patch) {
  const lines = String(patch || "").split("\n");
  const out = [];
  for (const l of lines) {
    if (l.startsWith("diff --git") || l.startsWith("--- ") || l.startsWith("+++ ") || l.startsWith("@@")) continue;
    if (l.startsWith("+")) out.push(l.slice(1));
    else if (l.startsWith(" ")) out.push(l.slice(1));
  }
  return out.join("\n");
}

const normalize = (s = "") =>
  String(s || "")
    .replace(/^[+-]/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function getSeverityBorderColor(severity) {
  const sev = String(severity || "info").toLowerCase();
  if (sev === "critical" || sev === "blocker") return "#ef4444";
  if (sev === "warning" || sev === "major") return "#f59e0b";
  return "#2563eb";
}

function InlineComment({ finding, file }) {
  const [loading, setLoading] = useState(false);
  const [fix, setFix] = useState(null);
  const [show, setShow] = useState(false);

  const sev = String(finding?.severity || "info").toLowerCase();
  const classification = finding?.classification || "IFS_ERP";

  const classThemes = {
    IFS_AQS: {
      borderLeft: "4px solid #7c3aed",
      bg: "#f5f3ff",
      color: "#6d28d9",
      label: "Aurena Quality Standard",
      icon: "🛡️"
    },
    ORACLE: {
      borderLeft: "4px solid #ea580c",
      bg: "#fff7ed",
      color: "#c2410c",
      label: "Oracle Database Rule",
      icon: "🛢️"
    },
    IFS_ERP: {
      borderLeft: "4px solid #0284c7",
      bg: "#f0f9ff",
      color: "#0369a1",
      label: "IFS ERP Framework",
      icon: "⚙️"
    }
  };

  const theme = classThemes[classification] || classThemes.IFS_ERP;

  const handleGenerateFix = async () => {
    setLoading(true);
    setShow(true);
    try {
      const res = await window.api.generateFix({
        filename: file?.filename || "",
        matchText: finding?.matchText || "",
        title: finding?.title || "",
        explanation: finding?.explanation || "",
        filePatch: file?.patch || ""
      });
      setFix(res);
    } catch (e) {
      console.error(e);
      setFix({ error: e.message || "Failed to generate fix" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`inline-comment ${sev}`} style={{ ...commentStyles.card, borderLeft: theme.borderLeft }}>
      <div className="inline-hdr" style={commentStyles.hdr}>
        <span className="class-badge" style={{ ...commentStyles.classBadge, backgroundColor: theme.bg, color: theme.color }}>
          {theme.icon} {theme.label}
        </span>
        <span className="sev" style={{ ...commentStyles.badge, borderColor: getSeverityBorderColor(sev) + "50", color: getSeverityBorderColor(sev) }}>
          {sev.toUpperCase()}
        </span>
        {finding?.ruleId && (
          <span style={commentStyles.ruleIdBadge}>
            {finding.ruleId}
          </span>
        )}
      </div>
      <div className="inline-ttl" style={commentStyles.ttl}>
        {finding?.title || "Finding"}
      </div>
      <div className="inline-body" style={commentStyles.body}>
        {finding?.explanation || ""}
      </div>
      {finding?.recommendation && (
        <div style={commentStyles.recommendation}>
          <strong>Suggestion:</strong> {finding.recommendation}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {!show && (
          <button onClick={handleGenerateFix} style={commentStyles.btn}>
            💡 Generate Auto-Fix
          </button>
        )}
        {show && (
          <div style={commentStyles.fixContainer}>
            {loading && <div style={{ fontSize: 12, color: "#4b5563" }}>Generating smart fix with AI...</div>}
            {!loading && fix && (
              <>
                {fix.error ? (
                  <div style={{ color: "#ef4444", fontSize: 12 }}>{fix.error}</div>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: "bold", color: "#4f46e5" }}>AI SUGGESTED FIX:</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(fix.suggestedFix);
                          alert("Fix copied to clipboard!");
                        }}
                        style={commentStyles.copyBtn}
                      >
                        📋 Copy Fix
                      </button>
                    </div>
                    <pre style={commentStyles.pre}>{fix.suggestedFix}</pre>
                    {fix.notes && (
                      <div style={{ fontSize: 11, color: "#666", marginTop: 4, fontStyle: "italic" }}>
                        Note: {fix.notes}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            <button onClick={() => setShow(false)} style={commentStyles.closeBtn}>
              Hide Fix
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const commentStyles = {
  card: {
    padding: 14,
    borderRadius: 8,
    background: "#f8fafc",
    border: "1px solid rgba(148, 163, 184, 0.25)",
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.05)",
    textAlign: "left",
    margin: "8px 0"
  },
  hdr: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    marginBottom: 8,
    flexWrap: "wrap"
  },
  classBadge: {
    fontSize: 10,
    fontWeight: "bold",
    padding: "3px 8px",
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    gap: 4
  },
  badge: {
    fontSize: 10,
    fontWeight: "bold",
    padding: "2px 6px",
    background: "#fff",
    borderRadius: 4,
    border: "1px solid rgba(0,0,0,0.06)"
  },
  ruleIdBadge: {
    fontSize: 10,
    color: "#64748b",
    marginLeft: "auto",
    background: "#f1f5f9",
    padding: "2px 6px",
    borderRadius: 4,
    fontFamily: "monospace"
  },
  ttl: {
    fontWeight: "bold",
    fontSize: 14,
    color: "#0f172a",
    marginBottom: 6
  },
  body: {
    fontSize: 13,
    color: "#334155",
    lineHeight: 1.5
  },
  recommendation: {
    marginTop: 8,
    fontSize: 12.5,
    color: "#2563eb",
    background: "#eff6ff",
    padding: 8,
    borderRadius: 6,
    borderLeft: "3px solid #3b82f6"
  },
  btn: {
    background: "#4f46e5",
    color: "#fff",
    border: "none",
    padding: "6px 12px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: "600",
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(79, 70, 229, 0.15)"
  },
  fixContainer: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: 10,
    marginTop: 8
  },
  pre: {
    fontFamily: 'Consolas, Monaco, "Andale Mono", monospace',
    fontSize: 12,
    background: "#fffff",
    color: "000000",
    padding: 10,
    borderRadius: 6,
    overflowX: "auto",
    margin: "6px 0"
  },
  copyBtn: {
    background: "#f1f5f9",
    border: "1px solid #cbd5e1",
    padding: "3px 8px",
    borderRadius: 4,
    fontSize: 11,
    cursor: "pointer"
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "#64748b",
    fontSize: 11,
    cursor: "pointer",
    marginTop: 6,
    textDecoration: "underline"
  }
};

const toolbarStyles = {
  segmentedGroup: {
    display: "inline-flex",
    background: "#f1f5f9",
    padding: 4,
    borderRadius: 8,
    border: "1px solid #cbd5e1"
  },
  segmentedBtn: {
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: "600",
    color: "#475569",
    border: "none",
    background: "transparent",
    borderRadius: 6,
    cursor: "pointer",
    transition: "all 0.15s ease"
  },
  segmentedBtnActive: {
    background: "#ffffff",
    color: "#0f172a",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)"
  }
};

export default function DiffViewer({ file, findings = [], onRequestFullFile }) {
  const [mode, setMode] = useState("side"); // inline | side | modified
  const [expandedFolds, setExpandedFolds] = useState(() => new Set());

  const surfaceRef = useRef(null);
  const toolbarRef = useRef(null);
  const [dividerPos, setDividerPos] = useState(50);
  const isDragging = useRef(false);
  useEffect(() => {
    const handleMove = (e) => {
      if (!isDragging.current) return;

      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return;

      const percent = ((e.clientX - rect.left) / rect.width) * 100;

      if (percent > 10 && percent < 90) {
        setDividerPos(percent);
      }
    };

    const handleUp = () => {
      isDragging.current = false;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);
  const [showFull, setShowFull] = useState(false);
  const [fullText, setFullText] = useState("");
  const [fullLoading, setFullLoading] = useState(false);
  const [fullError, setFullError] = useState("");
  const [fullScreenMode, setFullScreenMode] = useState(false);

  const [autoLoaded, setAutoLoaded] = useState(false);
  const autoLoadedKeyRef = useRef("");

  const patch = file?.patch || "";
  const status = String(file?.status || "modified").toLowerCase();
  const omitted = status !== "added" && isLargeOmitted(patch);

  useEffect(() => {
    if (!file) return;
    if (status === "added") {
      setMode("inline");
    } else {
      setMode((prev) => (prev === "inline" ? "side" : prev));
    }
    setExpandedFolds(new Set());

    setShowFull(false);
    setFullText("");
    setFullError("");
    setFullLoading(false);
    setAutoLoaded(false);
  }, [file?.filename]);

  const hunks = useMemo(() => splitIntoHunksUnified(patch), [patch]);

  const findingsForFile = useMemo(() => {
    const fname = String(file?.filename || "");
    return (findings || []).filter((f) => !f?.filename || String(f.filename) === fname);
  }, [findings, file?.filename]);

  const toRenderHunks = hunks;
  const findingsCount = findingsForFile.length;

  const toggleFold = (foldId) => {
    setExpandedFolds((prev) => {
      const next = new Set(prev);
      if (next.has(foldId)) next.delete(foldId);
      else next.add(foldId);
      return next;
    });
  };

  const requestFullLatest = async (side = "new", { forceOpen = true } = {}) => {
    setFullError("");
    setFullLoading(true);
    setFullText("");

    if (forceOpen) setShowFull(true);

    try {
      if (!onRequestFullFile) throw new Error("Full file API not wired.");
      const txt = await onRequestFullFile(file, side);
      setFullText(txt || "");
    } catch (e) {
      setFullError(e?.message || "Failed to load full file");
    } finally {
      setFullLoading(false);
    }
  };

  useEffect(() => {
    if (!file?.filename) return;
    if (!omitted) return;
    if (!onRequestFullFile) return;

    const side = status === "removed" ? "old" : "new";
    const key = `${file.filename}::${side}`;

    if (autoLoadedKeyRef.current === key) return;
    autoLoadedKeyRef.current = key;

    if (autoLoaded) return;
    setAutoLoaded(true);

    requestFullLatest(side, { forceOpen: true });
    setMode("inline");
  }, [file?.filename, omitted, status, onRequestFullFile]);

  if (!file) return <div className="empty">Select a file to view diff</div>;

  const addedFull = status === "added" ? extractAddedFileContentFromPatch(patch) : "";

  return (
    <>
      <div ref={surfaceRef} className={`diff-surface az mode-${mode}`}>
        <div className="sticky file-header">{file.filename}</div>

        <div className="diff-toolbar sticky" ref={toolbarRef}>
          <div className="diff-toolbar__left">
            <div className="segmented-control" style={toolbarStyles.segmentedGroup}>
              {[
                { id: "inline", label: "Unified" },
                { id: "side", label: "Split" },
                { id: "modified", label: "Changes Only" }
              ].map((btn) => (
                <button
                  key={btn.id}
                  onClick={() => setMode(btn.id)}
                  style={{
                    ...toolbarStyles.segmentedBtn,
                    ...(mode === btn.id ? toolbarStyles.segmentedBtnActive : {})
                  }}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          <div className="diff-toolbar__right">
            <span className="diff-toolbar__badge">{status.toUpperCase()}</span>
            <span className="diff-toolbar__stats">+{file.additions || 0} / -{file.deletions || 0}</span>
            <span className="diff-toolbar__stats">Findings: {findingsCount}</span>

            {showFull && (
              <button className="btn primary" onClick={() => setFullScreenMode(true)} title="View in full screen">
                ⛶ Full Screen
              </button>
            )}

            {onRequestFullFile && (
              <>
                <button className="btn primary" onClick={() => requestFullLatest("old")}>View base</button>
                <button className="btn primary" onClick={() => requestFullLatest("new")}>View latest</button>
              </>
            )}
          </div>
        </div>

        {showFull && (
          <div className="az-fullpanel">
            <div className="az-fullpanel__hdr">
              <b>Full file content</b>
              <button className="btn primary" onClick={() => setShowFull(false)}>
                Close
              </button>
            </div>

            {fullLoading && (
              <div className="muted" style={{ marginTop: 8 }}>
                Loading…
              </div>
            )}

            {fullError && (
              <div className="error" style={{ marginTop: 8 }}>
                {fullError}
              </div>
            )}

            {!fullLoading && !fullError && <pre className="az-fullpanel__pre">{fullText || "(empty)"}</pre>}
          </div>
        )}

        {status === "added" && addedFull && <pre className="az-addedfile">{addedFull}</pre>}

        {status !== "added" && omitted && !showFull && (
          <div className="empty" style={{ padding: 12 }}>
            Diff is not available (omitted/truncated).
            {onRequestFullFile ? (
              <>
                {" "}
                Auto-loading full file… If it doesn’t appear, use <b>View latest</b> / <b>View base</b>.
              </>
            ) : (
              <>
                {" "}
                Wire <b>onRequestFullFile</b> to enable full-file loading.
              </>
            )}
          </div>
        )}

        {!omitted && status !== "added" && (
          <>
            {/* ✅ INLINE MODE (UNCHANGED) */}
            {mode === "inline" ? (
              <table className="diff-table mode-inline">
                <tbody>
                  {toRenderHunks.map((h, hIdx) => {
                    const pairedAll = buildSplitRowsFromHunk(h.header, h.lines);

                    const rows = [];

                    rows.push(
                      <tr key={`h-${hIdx}`}>
                        <td colSpan={3} className="hunk-header-cell">
                          {h.header}
                        </td>
                      </tr>
                    );

                    pairedAll.forEach((r, idx) => {
                      const marker =
                        r.kind === "add" ? "+" : r.kind === "del" ? "-" : " ";
                      const text =
                        r.kind === "del"
                          ? r.left || ""
                          : r.right || r.left || "";

                      rows.push(
                        <tr key={`${hIdx}-${idx}`} className={`inline-row ${r.kind}`}>
                          <td>{r.oldNo ?? ""}</td>
                          <td>{r.newNo ?? ""}</td>
                          <td>
                            {marker} {text}
                          </td>
                        </tr>
                      );
                    });

                    return rows;
                  })}
                </tbody>
              </table>
            ) : (
              /* ✅ SPLIT + MODIFIED RESIZABLE VIEW */
              <div
                style={{
                  display: "flex",
                  width: "100%",
                  height: "100%",
                  position: "relative"
                }}
              >
                {/* ✅ LEFT PANEL */}
                <div
                  style={{
                    width: `${dividerPos}%`,
                    overflow: "auto",
                    borderRight: "1px solid #e2e8f0"
                  }}
                >
                  <table className="diff-table">
                    <tbody>
                      {toRenderHunks.map((h, hIdx) => {
                        const pairedAll = buildSplitRowsFromHunk(h.header, h.lines);

                        const paired =
                          mode === "modified"
                            ? pairedAll.filter((r) => r.kind !== "ctx")
                            : pairedAll;

                        const rows = [];

                        rows.push(
                          <tr key={`L-h-${hIdx}`}>
                            <td colSpan={2} className="hunk-header-cell">
                              {h.header}
                            </td>
                          </tr>
                        );

                        paired.forEach((r, i) => {
                          rows.push(
                            <tr key={`L-${hIdx}-${i}`} className={`split-row ${r.kind}`}>
                              <td className="split-ln-cell old">
                                {r.oldNo ?? ""}
                              </td>
                              <td className={`split-code-cell old ${r.kind}`}>
                                {r.left ? r.left.slice(1) : ""}
                              </td>
                            </tr>
                          );
                        });

                        return rows;
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ✅ DRAG DIVIDER */}
                <div
                  onMouseDown={() => (isDragging.current = true)}
                  style={{
                    width: "6px",
                    cursor: "col-resize",
                    background: isDragging.current ? "#6366f1" : "#cbd5f5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 10
                  }}
                >
                  <div
                    style={{
                      width: "2px",
                      height: "20px",
                      background: "#6366f1"
                    }}
                  />
                </div>

                {/* ✅ RIGHT PANEL */}
                <div
                  style={{
                    width: `${100 - dividerPos}%`,
                    overflow: "auto"
                  }}
                >
                  <table className="diff-table">
                    <tbody>
                      {toRenderHunks.map((h, hIdx) => {
                        const pairedAll = buildSplitRowsFromHunk(h.header, h.lines);

                        const paired =
                          mode === "modified"
                            ? pairedAll.filter((r) => r.kind !== "ctx")
                            : pairedAll;

                        const rows = [];

                        rows.push(
                          <tr key={`R-h-${hIdx}`}>
                            <td colSpan={2} className="hunk-header-cell">
                              {h.header}
                            </td>
                          </tr>
                        );

                        paired.forEach((r, i) => {
                          rows.push(
                            <tr key={`R-${hIdx}-${i}`} className={`split-row ${r.kind}`}>
                              <td className="split-ln-cell new">
                                {r.newNo ?? ""}
                              </td>
                              <td className={`split-code-cell new ${r.kind}`}>
                                {r.right ? r.right.slice(1) : ""}
                              </td>
                            </tr>
                          );
                        });

                        return rows;
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {fullScreenMode && (
        <div className="fullscreen-overlay">
          <div className="fullscreen-container">
            <div className="fullscreen-header">
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="fullscreen-title">{file.filename}</div>
                <div className="muted" style={{ fontSize: 12 }}>Full file source code view</div>
              </div>
              <button className="btn" onClick={() => setFullScreenMode(false)}>✖ Close</button>
            </div>
            <div className="fullscreen-body">
              {fullLoading && <div className="muted">Loading…</div>}
              {fullError && <div className="error">{fullError}</div>}
              {!fullLoading && !fullError && <pre className="fullscreen-pre">{fullText || "(empty)"}</pre>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
