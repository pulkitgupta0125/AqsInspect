import React, { useMemo, useState } from "react";

const getPath = (f) => f?.filename || f?.fileName || f?.path || "";

function getStatusBadge(status) {
  if (!status) return null;
  const s = String(status).toLowerCase();
  if (s === "added" || s === "add") {
    return <span style={{ color: "var(--green, #3fb950)", marginLeft: 6, fontWeight: "bold", fontSize: "11px" }}>(+)</span>;
  }
  if (s === "removed" || s === "deleted" || s === "delete") {
    return <span style={{ color: "var(--red, #f85149)", marginLeft: 6, fontWeight: "bold", fontSize: "11px" }}>(-)</span>;
  }
  if (s === "modified" || s === "edit" || s === "renamed" || s === "changed") {
    return <span style={{ color: "var(--sky, #58a6ff)", marginLeft: 6, fontWeight: "bold", fontSize: "11px" }}>[edit]</span>;
  }
  return null;
}

/* File extension → color-coded icon */
function FileIcon({ name = "" }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map = {
    js: { color: "#f7df1e", label: "JS" },
    jsx: { color: "#61dafb", label: "JSX" },
    ts: { color: "#3178c6", label: "TS" },
    tsx: { color: "#3178c6", label: "TSX" },
    css: { color: "#38bdf8", label: "CSS" },
    scss: { color: "#cc6699", label: "SCSS" },
    less: { color: "#1d365d", label: "LESS" },
    html: { color: "#f97316", label: "HTML" },
    xml: { color: "#f97316", label: "XML" },
    json: { color: "#fbbf24", label: "JSON" },
    sql: { color: "#818cf8", label: "SQL" },
    py: { color: "#3b82f6", label: "PY" },
    cs: { color: "#9b59b6", label: "C#" },
    java: { color: "#f89820", label: "JV" },
    go: { color: "#00acd7", label: "GO" },
    rb: { color: "#cc342d", label: "RB" },
    rs: { color: "#ee4b2b", label: "RS" },
    md: { color: "#64748b", label: "MD" },
    yaml: { color: "#6db33f", label: "YML" },
    yml: { color: "#6db33f", label: "YML" },
    sh: { color: "#22c55e", label: "SH" },
    bat: { color: "#22c55e", label: "BAT" },
    toml: { color: "#9ca3af", label: "TM" },
    env: { color: "#22c55e", label: "ENV" },
    txt: { color: "#6e7681", label: "TXT" },
  };
  const info = map[ext] ?? { color: "#6e7681", label: ext.slice(0, 2).toUpperCase() || "?" };
  return (
    <span style={{
      width: 17, height: 17, borderRadius: 3,
      background: `${info.color}22`,
      border: `1px solid ${info.color}44`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 7, fontWeight: 800, color: info.color,
      flexShrink: 0, letterSpacing: 0, lineHeight: 1,
    }}>
      {info.label}
    </span>
  );
}

function SeverityDot({ stats }) {
  if (!stats) return null;
  if ((stats.critical || 0) > 0)
    return <span className="sev-dot critical" title={`${stats.critical} blocker(s)`} />;
  if ((stats.warning || 0) > 0)
    return <span className="sev-dot warning" title={`${stats.warning} major issue(s)`} />;
  if ((stats.info || 0) > 0)
    return <span className="sev-dot info" title={`${stats.info} minor issue(s)`} />;
  return null;
}

function badgeClass(stats) {
  if (!stats) return "none";
  if ((stats.critical || 0) > 0) return "critical";
  if ((stats.warning || 0) > 0) return "warning";
  if ((stats.info || 0) > 0) return "info";
  return "none";
}

export default function FileTree({
  nodes = [],
  onFileSelect,
  selectedFile,
  statsByFile = {},
}) {
  return (
    <div className="az-tree">
      {nodes.map((node, idx) => (
        <TreeNode
          key={`${node?.name || "node"}-${idx}`}
          node={node}
          level={0}
          onFileSelect={onFileSelect}
          selectedFile={selectedFile}
          statsByFile={statsByFile}
        />
      ))}
    </div>
  );
}

function TreeNode({ node, level, onFileSelect, selectedFile, statsByFile }) {
  const [open, setOpen] = useState(true);
  const pad = 10 + level * 14;

  const selectedPath = getPath(selectedFile);
  const nodePath = node?.type === "file" ? getPath(node?.fileData) : "";
  const isSelected = nodePath && selectedPath && nodePath === selectedPath;

  const fileStats = node?.type === "file" ? statsByFile[nodePath] : null;

  const folderAgg = useMemo(() => {
    if (node?.type !== "folder") return null;
    let critical = 0, warning = 0, info = 0;
    const walk = (x) => {
      if (!x) return;
      if (x.type === "file") {
        const p = getPath(x.fileData);
        const s = statsByFile[p];
        if (s) { critical += s.critical || 0; warning += s.warning || 0; info += s.info || 0; }
        return;
      }
      (x.children || []).forEach(walk);
    };
    walk(node);
    return { critical, warning, info };
  }, [node, statsByFile]);

  // Folder node
  if (node?.type === "folder") {
    return (
      <div>
        <div
          className="az-tree-row az-tree-folder"
          onClick={() => setOpen((v) => !v)}
          style={{ paddingLeft: pad }}
          title={node.name}
        >
          <span className="az-tree-caret">
            {open ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M2 3l3 4 3-4z"/></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M3 2l4 3-4 3z"/></svg>
            )}
          </span>

          <span className="az-tree-icon" aria-hidden>
            {open ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M3 7c0-1.1.9-2 2-2h4l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" fill="#f59e0b" fillOpacity="0.9"/>
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M3 7c0-1.1.9-2 2-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" fill="#f59e0b" fillOpacity="0.6"/>
              </svg>
            )}
          </span>

          <span className="az-tree-name">{node.name}</span>

          {/* No warning, major, minor stats shown against folder */}
        </div>

        {open && node.children?.length > 0 && (
          <div className="az-tree-indent">
            {node.children.map((child, i) => (
              <TreeNode
                key={`${child?.name || "child"}-${i}`}
                node={child}
                level={level + 1}
                onFileSelect={onFileSelect}
                selectedFile={selectedFile}
                statsByFile={statsByFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File node
  return (
    <div
      className={`az-tree-row az-tree-file ${isSelected ? "active" : ""}`}
      onClick={() => onFileSelect?.(node.fileData)}
      style={{ paddingLeft: pad }}
      title={nodePath}
    >
      <span className="az-tree-icon" aria-hidden>
        <FileIcon name={node.name || ""} />
      </span>

      <span className="az-tree-name">
        {node.name}
        {getStatusBadge(node?.fileData?.status)}
      </span>

      {node?.fileData?.processing && (
        <span className="file-spinner" style={{ 
          marginLeft: 'auto', 
          marginRight: 6,
          display: 'inline-block', 
          width: 11, 
          height: 11, 
          border: '2px solid rgba(255,255,255,0.15)', 
          borderTopColor: 'var(--accent-light)', 
          borderRadius: '50%', 
          animation: 'spin 0.8s linear infinite',
          flexShrink: 0
        }} />
      )}

      <SeverityDot stats={fileStats} />
    </div>
  );
}
