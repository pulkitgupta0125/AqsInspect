import React, { useMemo, useState } from "react";

const getPath = (f) => f?.filename || f?.fileName || f?.path || "";

function pickAIIcon(stats) {
  if (!stats) return "";
  if ((stats.critical || 0) > 0) return "🔴";
  if ((stats.warning || 0) > 0) return "🟡";
  if ((stats.info || 0) > 0) return "🟢";
  return "";
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
  statsByFile = {}, // filename -> {critical, warning, info, total, additions, deletions}
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

  // indentation uses inline style only for left padding (everything else via CSS classes)
  const pad = 10 + level * 14;

  const selectedPath = getPath(selectedFile);
  const nodePath = node?.type === "file" ? getPath(node?.fileData) : "";
  const isSelected = nodePath && selectedPath && nodePath === selectedPath;

  const fileStats = node?.type === "file" ? statsByFile[nodePath] : null;

  // Folder rollup stats (AI + additions/deletions)
  const folderAgg = useMemo(() => {
    if (node?.type !== "folder") return null;
    // keep folder aggregation minimal: only counts of severities
    let critical = 0, warning = 0, info = 0;
    const walk = (x) => {
      if (!x) return;
      if (x.type === "file") {
        const p = getPath(x.fileData);
        const s = statsByFile[p];
        if (s) {
          critical += s.critical || 0;
          warning += s.warning || 0;
          info += s.info || 0;
        }
        return;
      }
      (x.children || []).forEach(walk);
    };
    walk(node);
    return { critical, warning, info };
  }, [node, statsByFile]);

  // =========================
  // Folder node (Azure-like)
  // =========================
  if (node?.type === "folder") {
    const icon = pickAIIcon(folderAgg);
    const changeBadge =
      folderAgg && (folderAgg.additions || folderAgg.deletions)
        ? `+${folderAgg.additions || 0} / -${folderAgg.deletions || 0}`
        : "";

    return (
      <div>
        <div
          className="az-tree-row az-tree-folder"
          onClick={() => setOpen((v) => !v)}
          style={{ paddingLeft: pad }}
          title={node.name}
        >
          <span className="az-tree-caret">{open ? "▾" : "▸"}</span>
          <span className="az-tree-icon" aria-hidden>{open ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7c0-1.1.9-2 2-2h3l2 2h7a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" fill="#f59e0b"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7c0-1.1.9-2 2-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" fill="#f59e0b"/></svg>
          )}</span>

          <span className="az-tree-name">{node.name}</span>

          {/* Do not show severity badges for folders (only files should show severity) */}
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

  // =========================
  // File node (Azure-like)
  // =========================
  const aiIcon = pickAIIcon(fileStats);
  const changeBadge = "";

  return (
    <div
      className={`az-tree-row az-tree-file ${isSelected ? "active" : ""}`}
      onClick={() => onFileSelect?.(node.fileData)}
      style={{ paddingLeft: pad }}
      title={nodePath}
    >
      <span className="az-tree-icon" aria-hidden>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" fill="#2563eb"/></svg>
      </span>

      <span className="az-tree-name">{node.name}</span>

      {aiIcon ? <span className="az-tree-badge">{aiIcon}</span> : null}
    </div>
  );
}
