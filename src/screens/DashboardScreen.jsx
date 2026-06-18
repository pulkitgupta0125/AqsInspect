import React, { useEffect, useMemo, useRef, useState } from "react";
import "../styles.css";
// Files visible in navigator
import FileTree from "../components/FileTree"
import { buildFileTree } from "../utils/fileTree"
import DiffViewer from "../components/DiffViewer";
import AIInsightsPanel from "../components/AIInsightsPanel";
import ReviewWorkflowPanel from "../components/ReviewWorkflowPanel";
import logo from "../../assets/icon1.png";
/* -----------------------------
   Helpers: path matching
------------------------------ */
const normPath = (p) => (p || "").replace(/\\/g, "/").trim();

const baseName = (p) => {
  const n = normPath(p);
  const parts = n.split("/");
  return parts[parts.length - 1] || n;
};

const getFormattedDate = (dateStr) => {
  if (!dateStr || dateStr === '(unknown)' || dateStr === 'N/A') return 'N/A';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return dateStr;
  }
};

const renderStatusBadge = (status) => {
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
};


const fileMatches = (findingFile, filePath) => {
  if (!findingFile) return true;
  const a = normPath(findingFile);
  const b = normPath(filePath);
  if (!a || !b) return false;
  if (a === b) return true;
  if (baseName(a) === baseName(b)) return true;
  return b.endsWith(a) || a.endsWith(b);
};

// Stable key to associate findings -> DOM anchors
const makeFindingKey = (f) => {
  const fn = normPath(f?.filename || "");
  const title = String(f?.title || "").trim();
  const match = String(f?.matchText || "").trim();
  const sev = String(f?.severity || "").trim();
  // matchText is most useful to locate; include title/sev to reduce collisions
  return `${fn}::${sev}::${title}::${match}`;
};

/* -----------------------------
   Helpers: module grouping for navigator
------------------------------ */


export default function DashboardScreen({ config, setConfig, repoType, setRepoType, selectedCustomer, setSelectedCustomer, setShowSettings, setShowAbout }) {
  const [topSearch, setTopSearch] = useState("");
  /* =============================
     Core state
  ============================= */
  const [filters, setFilters] = useState({ createdFrom: "", createdTo: "", createdBy: "", status: "open" });
  const [prList, setPrList] = useState([]);
  // Full cached list of PRs downloaded from provider
  const [prListAll, setPrListAll] = useState([]);
  const [prListLoading, setPrListLoading] = useState(false);
  const [selectedPrId, setSelectedPrId] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [isPrUrlEditable, setIsPrUrlEditable] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");

  const [prMeta, setPrMeta] = useState(null);
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);

  const [unifiedDiff, setUnifiedDiff] = useState("");
  const [aiReview, setAiReview] = useState(null);

  const resetPrData = () => {
    setPrMeta(null);
    setFiles([]);
    setUnifiedDiff("");
    setAiReview(null);
    setSelectedFile(null);
    setError(null);
    setStatusMessage("");
    setReviewProgress(null);
  };

  // Findings filter chips (critical/warning/info/all) still supported
  const [activeFilter, setActiveFilter] = useState("all");

  // Pane collapse states (keep your existing UX)
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isDragging, setIsDragging] = useState(false);

  const initDrag = (e) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const doDrag = (moveEvent) => {
      const newWidth = startWidth + (moveEvent.clientX - startX);
      if (newWidth >= 160 && newWidth <= 600) {
        setSidebarWidth(newWidth);
      }
    };

    const stopDrag = () => {
      setIsDragging(false);
      window.removeEventListener("mousemove", doDrag);
      window.removeEventListener("mouseup", stopDrag);
    };

    window.addEventListener("mousemove", doDrag);
    window.addEventListener("mouseup", stopDrag);
  };

  // ✅ NEW: AI review popup
  const [showAIReviewPopup, setShowAIReviewPopup] = useState(false);
  const [showDiffDialog, setShowDiffDialog] = useState(false);

  // ✅ NEW: Review progress dialog
  const [reviewProgress, setReviewProgress] = useState(null);

  // ✅ NEW: Rate limit retry handler
  const [rateLimitRetry, setRateLimitRetry] = useState(null);

  // ✅ NEW: Impact filter toggle (navigator shows only impacted files)
  const [showImpactedOnly, setShowImpactedOnly] = useState(true);

  // ✅ NEW: Active finding highlight (when user clicks a finding in popup)
  const [activeFindingKey, setActiveFindingKey] = useState("");

  // ✅ NEW: Feedback loop state & helpers
  const [feedbackMap, setFeedbackMap] = useState({});

  const loadFeedbackMap = async () => {
    try {
      const res = await window.api.loadFeedback();
      if (res?.ok && res?.feedback) {
        setFeedbackMap(res.feedback);
      }
    } catch (e) {
      console.error("Failed to load feedback:", e);
    }
  };

  const handleSaveFeedback = async (finding, status) => {
    const key = makeFindingKey(finding);
    try {
      const res = await window.api.saveFeedback({ findingKey: key, status });
      if (res?.ok) {
        setFeedbackMap(prev => ({
          ...prev,
          [key]: { status, timestamp: new Date().toISOString() }
        }));
      }
    } catch (e) {
      console.error("Failed to save feedback:", e);
    }
  };

  // Anchors used for jumping between inline comments (existing pattern)
  const anchorsRef = useRef([]);
  const anchorKeyToIndex = useRef(new Map());
  const [issueIndex, setIssueIndex] = useState(0);

  // ✅ NEW: map findingKey -> DOM element (for accurate scroll)
  const findingAnchorMapRef = useRef(new Map());

  /* =============================
     Derived: impacted files, scoped findings, grouping
  ============================= */
  const allFindings = useMemo(() => aiReview?.findings || [], [aiReview]);

  const calculatedScore = useMemo(() => {
    if (!aiReview) return null;
    let high = 0, medium = 0, low = 0;
    (aiReview.findings || []).forEach((item) => {
      const severityRaw = String(item.severity || "info").toLowerCase();
      if (severityRaw === "blocker" || severityRaw === "critical") high++;
      else if (severityRaw === "major" || severityRaw === "warning") medium++;
      else low++;
    });
    return Math.max(0, 100 - (high * 40 + medium * 15 + low * 5));
  }, [aiReview]);

  const searchQuery = useMemo(() => String(topSearch || "").trim().toLowerCase(), [topSearch]);

  const prOwners = useMemo(() => {
    return [...new Set(prList.map((p) => p.createdBy || "").filter(Boolean))].sort();
  }, [prList]);

  const actualFilesOnly = useMemo(() => {
    return (files || []).filter((f) => f && f.filename && !f.isFolder && !f.isDirectory && !f.filename.endsWith('/'));
  }, [files]);

  const activePr = useMemo(() => {
    return prList.find(p => String(p.id) === String(selectedPrId)) || prMeta;
  }, [prList, selectedPrId, prMeta]);

  const activeAzureRepo = useMemo(() => {
    if (config?.multiRepo && Array.isArray(config?.azureRepos)) {
      return config.azureRepos.find(r => r.customer === selectedCustomer) || config.azureRepos[0] || {};
    }
    return config?.azure || {};
  }, [config, selectedCustomer]);

  const activeGithubRepo = useMemo(() => {
    if (config?.multiRepoGithub && Array.isArray(config?.githubRepos)) {
      return config.githubRepos.find(r => r.customer === selectedCustomer) || config.githubRepos[0] || {};
    }
    return config?.github || {};
  }, [config, selectedCustomer]);

  const isAcceptEnabled = useMemo(() => {
    return repoType === "azure"
      ? activeAzureRepo?.enableAccept !== false
      : activeGithubRepo?.enableAccept !== false;
  }, [repoType, activeAzureRepo, activeGithubRepo]);

  const isRejectEnabled = useMemo(() => {
    return repoType === "azure"
      ? activeAzureRepo?.enableReject !== false
      : activeGithubRepo?.enableReject !== false;
  }, [repoType, activeAzureRepo, activeGithubRepo]);

  const fileTree = useMemo(() => {
    if (!Array.isArray(actualFilesOnly)) return [];

    const actualFiles = actualFilesOnly.filter((f) => f?.filename && f.filename.includes("."));
    if (!searchQuery) return buildFileTree(actualFiles);

    const filteredFiles = actualFiles.filter((file) => {
      const filename = String(file.filename || "").toLowerCase();
      if (filename.includes(searchQuery)) return true;

      return (allFindings || []).some((finding) => {
        if (!fileMatches(finding.filename, file.filename)) return false;
        const text = `${finding.title || ""} ${finding.explanation || ""} ${finding.matchText || ""}`.toLowerCase();
        return text.includes(searchQuery);
      });
    });

    return buildFileTree(filteredFiles);
  }, [actualFilesOnly, searchQuery, allFindings]);

  // impactedTree will be computed after visibleFiles is available (see below)

  const impactedSet = useMemo(() => {
    const s = new Set();
    (allFindings || []).forEach((f) => {
      if (f?.filename) s.add(normPath(f.filename));
    });
    return s;
  }, [allFindings]);


  //const fileTree = buildFileTree(files);

  const visibleFiles = useMemo(() => {
    if (!showImpactedOnly) return actualFilesOnly;
    return (actualFilesOnly || []).filter((f) => impactedSet.has(normPath(f.filename)));
  }, [actualFilesOnly, impactedSet, showImpactedOnly]);

  const impactedTree = useMemo(() => {
    // show only files that have been reviewed
    const reviewed = (actualFilesOnly || []).filter((f) => f.reviewed);
    if (!reviewed.length) return [];
    return buildFileTree(reviewed);
  }, [aiReview, actualFilesOnly]);

  // Filter findings by severity chip
  const filteredFindings = useMemo(() => {
    const all = allFindings || [];
    if (activeFilter === "all") return all;
    return all.filter((f) => (f.severity || "").toLowerCase() === activeFilter);
  }, [allFindings, activeFilter]);

  // ✅ Requirement: clicking file shows that file’s review only; no selection shows all
  const scopedFindings = useMemo(() => {
    if (!selectedFile) return filteredFindings;
    return (filteredFindings || []).filter((f) => fileMatches(f.filename, selectedFile.filename));
  }, [filteredFindings, selectedFile]);

  // Summary badges per file (robust match)
  const fileSummary = useMemo(() => {
    const summary = {};
    for (const file of actualFilesOnly) {
      const ff = (allFindings || []).filter((x) => fileMatches(x.filename, file.filename));
      // Map engine severities to UI badges: Blocker -> critical, Major -> warning, Minor/Info -> info
      summary[file.filename] = {
        critical: ff.filter((x) => ((x.severity || "") + "").toLowerCase() === "blocker").length,
        warning: ff.filter((x) => ((x.severity || "") + "").toLowerCase() === "major").length,
        info: ff.filter((x) => {
          const s = ((x.severity || "") + "").toLowerCase();
          return s === "minor" || s === "info";
        }).length,
        total: ff.length,
      };
    }
    return summary;
  }, [actualFilesOnly, allFindings]);

  const severityCounts = useMemo(() => {
    const counts = { critical: 0, warning: 0, info: 0 };
    (allFindings || []).forEach((finding) => {
      const raw = String(finding?.severity || "info").toLowerCase();
      if (raw === "blocker") counts.critical += 1;
      else if (raw === "major") counts.warning += 1;
      else if (raw === "minor" || raw === "info") counts.info += 1;
    });
    return counts;
  }, [allFindings]);

  const statsByFile = useMemo(() => {
    const m = {};
    (actualFilesOnly || []).forEach((f) => {
      const key = f?.filename || "";
      const s = fileSummary[key] || { critical: 0, warning: 0, info: 0, total: 0 };
      m[key] = {
        ...s,
        additions: f.additions || 0,
        deletions: f.deletions || 0,
      };
    });
    return m;
  }, [actualFilesOnly, fileSummary]);

  useEffect(() => {
    console.log("✅ FILES STRUCTURE →", JSON.stringify(files, null, 2))
  }, [files])

  /* =============================
     Jump controls (existing behaviour)
  ============================= */
  useEffect(() => {
    anchorsRef.current = [];
    anchorKeyToIndex.current = new Map();
    findingAnchorMapRef.current = new Map();
    setIssueIndex(0);
    setActiveFindingKey("");
  }, [selectedFile?.filename, activeFilter, aiReview?.findings?.length]);

  const goNextIssue = () => {
    const list = anchorsRef.current;
    if (!list.length) return;
    const next = (issueIndex + 1) % list.length;
    setIssueIndex(next);
    list[next]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const goPrevIssue = () => {
    const list = anchorsRef.current;
    if (!list.length) return;
    const prev = (issueIndex - 1 + list.length) % list.length;
    setIssueIndex(prev);
    list[prev]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /* =============================
     Pane helpers
  ============================= */
  const focusDiff = () => {
    setNavCollapsed(true);
  };
  const resetPanels = () => {
    setNavCollapsed(false);
  };

  // Keyboard shortcuts (kept)
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey) return;
      if (e.key === "\\") setNavCollapsed((v) => !v);
      if (e.key === "Enter") focusDiff();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* =============================
     Load feedback map once
  ============================= */
  useEffect(() => {
    loadFeedbackMap();
  }, []);

  /* =============================
     PR list + diff + AI review actions
  ============================= */
  // loadPRs accepts optional overrideFilters so the UI can trigger reloads immediately
  const loadPRs = async (overrideFilters) => {
    setPrListLoading(true);
    setError(null);
    //setStatusMessage("");

    const effectiveFilters = { ...(overrideFilters || filters), status: "open" };

    if (repoType === "github") {
      const g = activeGithubRepo;
      const t = g.token || config?.githubToken;
      if (!t) {
        setPrListLoading(false);
        setError("GitHub Token is missing. Please configure it in Settings.");
        return;
      }
      if (!(g.owner && g.repo)) {
        setPrListLoading(false);
        setError("GitHub repository owner/repo are missing. Please configure Owner and Repo in Settings.");
        return;
      }
    }

    if (repoType === "azure") {
      const a = activeAzureRepo;
      if (!(a?.org && a?.project && a?.repoIdOrName && a?.pat)) {
        setPrListLoading(false);
        setError("Azure DevOps settings are missing. Please configure org/project/repo/PAT in Settings.");
        return;
      }
    }

    try {
      const res = await window.api.listPullRequests({ repoType, filters: effectiveFilters, customer: selectedCustomer });
      if (!res?.ok) {
        setError(res?.error || "Failed to load PRs");
        return;
      }
      const prs = res.prs || [];
      setPrListAll(prs);
      // Apply client-side owner filter if present
      if (effectiveFilters?.createdBy) setPrList(prs.filter((p) => (p.createdBy || p.author || p.user || '').toString() === effectiveFilters.createdBy));
      else setPrList(prs);
    } catch {
      setError("Failed to load PRs");
    } finally {
      setPrListLoading(false);
    }
  };

  // Filter PR list client-side by owner to avoid reload
  const onSelectOwner = (owner) => {
    const nextFilters = { ...filters, createdBy: owner };
    setFilters(nextFilters);
    if (!owner) {
      setPrList(prListAll || []);
      return;
    }
    const filtered = (prListAll || []).filter((p) => {
      const c = (p.createdBy || p.author || p.user || '').toString();
      return c === owner;
    });
    setPrList(filtered);
  };

  const onSelectPR = (id) => {
    setSelectedPrId(id);
    resetPrData();
    setIsPrUrlEditable(false);
    const pr = prList.find((p) => p.id === id) || prListAll.find((p) => p.id === id);
    if (pr?.url) setPrUrl(pr.url);
    // Eagerly fetch PR details to capture developer and creation date for reports
    (async () => {
      try {
        const idOrUrl = pr?.url || id;
        if (!idOrUrl) return;
        const det = await window.api.getPullRequestDetails({ repoType, prUrlOrId: idOrUrl, customer: selectedCustomer });
        if (det?.ok && det.pr) setPrMeta(det.pr);
      } catch (e) {
        // ignore non-fatal
        console.warn('Failed to fetch PR details for selection', e?.message || e);
      }
    })();
  };

  const handleCustomerChange = async (cust) => {
    setSelectedCustomer(cust);
    setSelectedPrId('');
    setPrList([]);
    setPrListAll([]);
    setPrUrl('');
    resetPrData();

    // Reset filter states and anchors
    setFilters({ createdBy: "", createdFrom: "", createdTo: "" });
    setActiveFilter("all");
    setActiveFindingKey("");
    setIssueIndex(0);
    anchorsRef.current = [];
    anchorKeyToIndex.current = new Map();
    findingAnchorMapRef.current = new Map();

    try {
      if (repoType === "azure") {
        await window.api.saveConfig({ selectedCustomer: cust });
        setConfig(prev => ({ ...prev, selectedCustomer: cust }));
      } else {
        await window.api.saveConfig({ selectedCustomerGithub: cust });
        setConfig(prev => ({ ...prev, selectedCustomerGithub: cust }));
      }
    } catch (e) {
      console.warn("Failed to persist selected customer selection:", e);
    }
  };

  const handleRepoTypeChange = async (val) => {
    setRepoType(val);
    setSelectedPrId('');
    setPrList([]);
    setPrListAll([]);
    setPrUrl('');
    resetPrData();

    // Reset filter states and anchors
    setFilters({ createdBy: "", createdFrom: "", createdTo: "" });
    setActiveFilter("all");
    setActiveFindingKey("");
    setIssueIndex(0);
    anchorsRef.current = [];
    anchorKeyToIndex.current = new Map();
    findingAnchorMapRef.current = new Map();

    // Update selectedCustomer to match the new repoType default
    let nextCustomer = "";
    if (val === "azure") {
      if (config?.multiRepo && Array.isArray(config?.azureRepos) && config.azureRepos.length > 0) {
        nextCustomer = config.selectedCustomer || config.azureRepos[0].customer;
      }
    } else {
      if (config?.multiRepoGithub && Array.isArray(config?.githubRepos) && config.githubRepos.length > 0) {
        nextCustomer = config.selectedCustomerGithub || config.githubRepos[0].customer;
      }
    }
    setSelectedCustomer(nextCustomer);

    try {
      await window.api.saveConfig({ repoType: val });
      setConfig(prev => ({ ...prev, repoType: val }));
    } catch (e) {
      console.warn("Failed to persist repoType selection:", e);
    }
  };

  /* =============================
     Auto-load PRs on repoType or selectedCustomer change
  ============================= */
  useEffect(() => {
    loadPRs();
  }, [repoType, selectedCustomer]);

  const fetchDiff = async () => {
    resetPrData();
    setActiveFilter("all");
    anchorsRef.current = [];
    anchorKeyToIndex.current = new Map();
    findingAnchorMapRef.current = new Map();
    setIssueIndex(0);
    setActiveFindingKey("");

    if (!prUrl) {
      setError("PR URL is required");
      return;
    }

    if (repoType === "github") {
      const g = activeGithubRepo;
      const t = g?.token || config?.githubToken;
      if (!t) {
        setError("GitHub Token is missing. Please configure it in Settings.");
        return;
      }
    } else {
      const a = activeAzureRepo;
      if (!(a?.org && a?.project && a?.repoIdOrName && a?.pat)) {
        setError("Azure DevOps settings are missing. Please configure org/project/repo/PAT in Settings.");
        return;
      }
    }

    try {
      setLoading(true);
      const payload = {
        prUrl: selectedPrId || prUrl,
        repoType,
        customer: selectedCustomer
      };

      const result = await window.api.fetchPullRequestDiff(payload);
      setPrMeta(result.pr || null);
      setFiles(result.files || []);
      setSelectedFile((result.files && result.files[0]) || null);
      setUnifiedDiff(result.unifiedDiff || "");
    } catch (e) {
      console.error("Fetch diff failed:", e);
      setError(e.message || "Failed to fetch diff");
    } finally {
      setLoading(false);
    }
  };

  // Sequential per-file review for a PR: fetch diff, then review files one-by-one
  const reviewPullRequest = async () => {
    setError(null);
    setPrMeta(null);
    setFiles([]);
    setSelectedFile(null);
    setUnifiedDiff("");
    setAiReview(null);
    setReviewProgress(null);
    setStatusMessage("");
    setActiveFilter("all");
    anchorsRef.current = [];
    anchorKeyToIndex.current = new Map();
    findingAnchorMapRef.current = new Map();
    setIssueIndex(0);
    setActiveFindingKey("");

    if (!prUrl) {
      setError("PR URL is required");
      return;
    }

    try {
      setLoading(true);
      const payload = repoType === "github" ? { prUrl, repoType, token: config.githubToken || config.github?.token } : { prUrl: selectedPrId || prUrl, repoType, customer: selectedCustomer };
      const result = await window.api.fetchPullRequestDiff(payload);
      if (!result?.ok && !result?.files) {
        setError(result?.error || "Failed to fetch PR diff");
        setLoading(false);
        return;
      }

      setPrMeta(result.pr || null);
      // ✅ Filter: only review actual files (entries with a filename that contains a dot for extension)
      const allFiles = (result.files || []) || [];
      const fetchedFiles = allFiles
        .filter((f) => f?.filename && String(f.filename).includes(".")) // Only files with extensions
        .map((f) => ({ ...f, reviewed: false, processing: false }));
      setFiles(allFiles); // Keep all for tree display
      setUnifiedDiff(result.unifiedDiff || "");

      let completedCount = 0;
      let activeFiles = fetchedFiles.map(f => baseName(f.filename));
      setReviewProgress({
        current: 0,
        total: fetchedFiles.length,
        file: `Dispatched ${fetchedFiles.length} files: ${activeFiles.join(", ")}`
      });

      const aggregatedFindings = [];
      const reviewPromises = fetchedFiles.map(async (file) => {
        // update processing flag
        setFiles((prev) => prev.map((p) => (p.filename === file.filename ? { ...p, processing: true } : p)));
        try {
          const res = await window.api.runAIReview({
            unifiedDiff: file.patch || "",
            files: [file],
            prUrl: selectedPrId || prUrl,
            repoType,
            customer: selectedCustomer
          });
          const normalized = normalizeReview(res, [file]);
          // attach filename to findings if missing
          const fileFindings = (normalized.findings || []).map((ff) => ({ ...ff, filename: ff.filename || file.filename }));

          completedCount++;
          activeFiles = activeFiles.filter(name => name !== baseName(file.filename));
          setReviewProgress({
            current: completedCount,
            total: fetchedFiles.length,
            file: activeFiles.length > 0
              ? `Reviewing: ${activeFiles.join(", ")}`
              : "Consolidating all findings..."
          });
          setStatusMessage(`Reviewed ${completedCount}/${fetchedFiles.length} files`);

          setFiles((prev) => prev.map((p) => (p.filename === file.filename ? { ...p, reviewed: true, processing: false, findings: fileFindings } : p)));

          setSelectedFile((curr) => {
            if (curr) return curr;
            return { ...file, reviewed: true, processing: false, findings: fileFindings };
          });

          return fileFindings;
        } catch (e) {
          console.error("Per-file review failed:", e);
          completedCount++;
          activeFiles = activeFiles.filter(name => name !== baseName(file.filename));
          setReviewProgress({
            current: completedCount,
            total: fetchedFiles.length,
            file: activeFiles.length > 0
              ? `Reviewing: ${activeFiles.join(", ")}`
              : "Consolidating all findings..."
          });

          setFiles((prev) => prev.map((p) => (p.filename === file.filename ? { ...p, reviewed: false, processing: false, error: e?.message } : p)));
          return [];
        }
      });

      const findingsArrays = await Promise.all(reviewPromises);
      for (const findingsArr of findingsArrays) {
        aggregatedFindings.push(...findingsArr);
      }

      // set aggregated aiReview
      setAiReview({ findings: aggregatedFindings, fileReasoning: (result.fileReasoning || {}) });
      setStatusMessage(`Review complete: ${aggregatedFindings.length} findings across ${fetchedFiles.length} files`);
      setShowAIReviewPopup(true);
    } catch (e) {
      console.error("Review PR failed:", e);
      setError(e?.message || "Failed to review PR");
    } finally {
      setLoading(false);
      setReviewProgress(null);
    }
  };


  const composeReviewEmail = () => {
    const title = prMeta?.title || `PR Review`;
    const summaryParts = [
      `PR: ${prMeta?.url || prUrl}`,
      `Title: ${title}`,
      `Review score: ${aiReview?.score ?? "N/A"}`,
      `Critical: ${severityCounts.critical}`,
      `Medium: ${severityCounts.warning}`,
      `Info: ${severityCounts.info}`,
      "",
      `Summary: ${aiReview?.summary || "No summary available."}`,
      "",
      `Findings:\n${(aiReview?.findings || []).map((finding, idx) => `${idx + 1}. [${finding.severity}] ${finding.title}: ${finding.explanation}`).join("\n\n")}`,
    ];
    return summaryParts.join("\n");
  };

  // Compose a full markdown report for export/email
  const composeReviewReport = (prDetails = {}, review = null) => {
    const findings = (review?.findings || []);
    const grouped = {};
    findings.forEach((f) => {
      const fn = f.filename || "(unknown)";
      if (!grouped[fn]) grouped[fn] = [];
      grouped[fn].push(f);
    });

    const lines = [];
    lines.push(`# AQS Inspect - PR Review Report`);
    lines.push("");
    lines.push(`- PR: ${prDetails?.html_url || prMeta?.url || prUrl}`);
    lines.push(`- Title: ${prDetails?.title || prMeta?.title || "(unknown)"}`);
    const developer = prDetails?.createdBy || prDetails?.created_by || prDetails?.created_by_login || prDetails?.author || prMeta?.createdBy || prMeta?.created_by || "(unknown)";
    const createdAt = prDetails?.createdAt || prDetails?.created_at || prDetails?.created || prMeta?.createdAt || prMeta?.created_at || "(unknown)";
    lines.push(`- Developer: ${developer}`);
    lines.push(`- PR Created: ${createdAt}`);
    lines.push(`- Review generated: ${new Date().toISOString()}`);
    lines.push(`- Score: ${review?.score ?? "N/A"}`);
    lines.push("");
    lines.push(`## Summary`);
    lines.push(review?.summary || "No summary available.");
    lines.push("");

    lines.push(`## Findings (${findings.length})`);
    Object.keys(grouped).forEach((fname) => {
      lines.push("");
      lines.push(`### ${fname}`);
      grouped[fname].forEach((f, idx) => {
        lines.push(`- **${f.severity}**: ${f.title}`);
        if (f.explanation) lines.push(`  - ${f.explanation}`);
        if (f.recommendation) lines.push(`  - Suggestion: ${f.recommendation}`);
      });
    });

    lines.push("");
    lines.push(`---`);
    lines.push(`Generated by AQS Inspect`);

    return lines.join("\n");
  };

  const sendReviewEmail = async () => {
    if (!aiReview) {
      setError("Generate an AI review before sending email.");
      return;
    }

    const smtpConfig = config?.email || config?.smtp;
    if (smtpConfig?.disabled) {
      setError("Email sending is disabled in Settings.");
      return;
    }
    if (!smtpConfig?.host || !smtpConfig?.port || !smtpConfig?.user || !smtpConfig?.pass) {
      setError("SMTP email configuration is missing or incomplete (host, port, username, and password are required). Please configure it in Settings.");
      return;
    }

    try {
      // Fetch PR details (to get developer name, PR dates, and creator email)
      const prDetailsRes = await window.api.getPullRequestDetails({ repoType, prUrlOrId: selectedPrId || prUrl, customer: selectedCustomer });
      const prDetails = prDetailsRes?.pr || {};

      // Route primarily to the PR Creator/Author email address
      let toAddress = prDetails.creatorEmail || prMeta?.creatorEmail;
      if (!toAddress) {
        setError(`Could not resolve the email address of the PR creator (${prDetails.createdBy || prMeta?.createdBy || "unknown"}). Please ensure the PR creator has a configured email in their commits or profile.`);
        return;
      }

      const subject = `Code Review: ${prDetails?.title || prMeta?.title || prUrl}`;
      const report = composeReviewReport(prDetails, aiReview);

      const result = await window.api.sendEmail({
        subject,
        body: report,
        to: toAddress,
        from: smtpConfig.from,
        config: smtpConfig,
        prDetails,
        aiReview
      });

      if (!result?.ok) {
        setError(result?.error || "Failed to send review email.");
        return;
      }
      setStatusMessage("✅ Review email sent successfully.");
    } catch (e) {
      setError(e?.message || "Failed to send review email.");
    }
  };

  const getExportFilename = (prDetails, extension) => {
    const prId = prDetails?.id || prDetails?.number || prDetails?.pullRequestId || selectedPrId || 'report';
    let cleanPrId = prId;
    if (typeof prId === 'string' && prId.includes('http')) {
      const parts = prId.split('/');
      cleanPrId = parts[parts.length - 1] || 'report';
    }

    let repoName = repoType === 'github' ? activeGithubRepo?.repo : activeAzureRepo?.repoIdOrName;
    const urlToParse = prUrl || selectedPrId || prDetails?.url || prDetails?.html_url || '';
    if (!repoName && typeof urlToParse === 'string' && urlToParse.includes('http')) {
      try {
        const urlObj = new URL(urlToParse);
        if (repoType === 'github') {
          const parts = urlObj.pathname.split('/');
          if (parts.length >= 3) {
            repoName = parts[2];
          }
        } else if (repoType === 'azure') {
          const parts = urlObj.pathname.split('/');
          const gitIndex = parts.indexOf('_git');
          if (gitIndex !== -1 && gitIndex + 1 < parts.length) {
            repoName = parts[gitIndex + 1];
          } else if (parts.length >= 4) {
            repoName = parts[3];
          }
        }
      } catch (e) {
        console.warn('Failed to parse repo name from URL:', e);
      }
    }

    const sanitizeStr = (str) => {
      return str.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
    };

    const repoPart = repoName ? `${sanitizeStr(repoName)}_` : '';
    const prPart = cleanPrId && cleanPrId !== 'report' ? `PR_${cleanPrId}` : 'PR_report';
    return `AQS_Review_${repoPart}${prPart}.${extension}`;
  };

  const exportReport = async () => {
    if (!aiReview) {
      setError("Generate an AI review before exporting report.");
      return;
    }
    try {
      const prDetailsRes = await window.api.getPullRequestDetails({ repoType, prUrlOrId: selectedPrId || prUrl, customer: selectedCustomer });
      const prDetails = prDetailsRes?.pr || {};
      const md = composeReviewReport(prDetails, aiReview);
      const filename = getExportFilename(prDetails, 'md');
      const saved = await window.api.saveReport({ defaultFilename: filename, content: md });
      if (!saved?.ok) {
        if (saved?.error && saved.error !== 'cancelled') setError(saved.error || 'Failed to save report');
        return;
      }
      setStatusMessage(`✅ Report saved: ${saved.path}`);
    } catch (e) {
      setError(e?.message || 'Failed to export report.');
    }
  };

  const exportReportPdf = async () => {
    if (!aiReview) {
      setError("Generate an AI review before exporting report.");
      return;
    }
    try {
      const prDetailsRes = await window.api.getPullRequestDetails({ repoType, prUrlOrId: selectedPrId || prUrl, customer: selectedCustomer });
      const prDetails = prDetailsRes?.pr || prMeta || {};
      const md = composeReviewReport(prDetails, aiReview);
      const filename = getExportFilename(prDetails, 'pdf');
      const saved = await window.api.saveReportPdf({
        defaultFilename: filename,
        content: md,
        prDetails,
        aiReview
      });
      if (!saved?.ok) {
        if (saved?.error && saved.error !== 'cancelled') setError(saved.error || 'Failed to save PDF report');
        return;
      }
      setStatusMessage(`✅ PDF saved: ${saved.path}`);
    } catch (e) {
      setError(e?.message || 'Failed to export PDF report.');
    }
  };

  const performPRAction = async (action) => {
    if (!prUrl) {
      setError("PR URL is required to perform actions.");
      return;
    }
    setError(null);
    setStatusMessage("");

    if (action === "accept" && !isAcceptEnabled) {
      setError("Accept Pull Request action is disabled in Settings.");
      return;
    }
    if ((action === "reject" || action === "abandon") && !isRejectEnabled) {
      setError("Reject/Abandon Pull Request action is disabled in Settings.");
      return;
    }

    try {
      const res = await window.api.performPRAction({ repoType, prUrlOrId: prUrl, action, customer: selectedCustomer });
      if (!res?.ok) {
        setError(res?.error || `Failed to ${action} PR`);
        return;
      }
      await loadPRs();
      setStatusMessage(`PR ${action === "accept" ? "accepted" : action === "reject" ? "rejected" : "abandoned"} successfully.`);
    } catch (e) {
      setError(e?.message || `Failed to ${action} PR`);
    }
  };

  const runAiReview = async () => {
    setError(null);
    setStatusMessage("");
    if (!unifiedDiff) {
      setError("No diff available for AI review");
      return;
    }
    try {
      setAiLoading(true);
      setAiReview(null);
      setActiveFilter("all");
      anchorsRef.current = [];
      anchorKeyToIndex.current = new Map();
      findingAnchorMapRef.current = new Map();
      setIssueIndex(0);
      setActiveFindingKey("");

      const res = await window.api.runAIReview({
        unifiedDiff,
        files,
        prUrl: selectedPrId || prUrl,
        repoType,
        customer: selectedCustomer
      });
      const normalized = normalizeReview(res, files);
      setAiReview(normalized);

      // Open popup automatically after review (better UX)
      setShowAIReviewPopup(true);
      setRateLimitRetry(null);
    } catch (e) {
      console.error("AI review failed:", e);
      const msg = String(e?.message || "AI review failed");
      if (msg.includes("429") || msg.toLowerCase().includes("rate limit")) {
        setError("AI service rate limit reached. Please wait a moment and retry.");
        setRateLimitRetry(() => runAiReview);
      } else {
        setError(msg);
        setRateLimitRetry(null);
      }
    } finally {
      setAiLoading(false);
    }
  };

  /* =============================
     Review click -> open file + scroll to anchor + highlight
  ============================= */
  const jumpToFinding = async (finding) => {
    if (!finding) return;

    const key = makeFindingKey(finding);
    setActiveFindingKey(key);

    // Select file if needed
    const fileObj = files.find((f) => fileMatches(finding.filename, f.filename));
    if (fileObj) {
      setSelectedFile(fileObj);
      setShowDiffDialog(true);
    }

    // Wait for DOM render then scroll to anchor
    // Using two RAF ticks is more reliable than setTimeout in React
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = findingAnchorMapRef.current.get(key);
        if (el?.scrollIntoView) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    });
  };

  /* =============================
     Render
  ============================= */
  return (
    <div className="app-shell">
          {/* Top bar */}
          <div className="topbar">
            <div className="topbar__left">
              <div className="topbar__brand">
                <img src={logo} alt="AQS Inspect" className="topbar__logo-img" />
                <div className="topbar__title">
                  <div className="brand">AQS Inspect</div>
                  <div className="subtitle">AI Code Review</div>
                </div>
              </div>


            </div>

            <div className="topbar__actions">
              {/* Toggle Left Sidebar */}
              <button
                className={`btn-icon ${!navCollapsed ? "active" : ""}`}
                style={!navCollapsed ? { color: "var(--accent)" } : {}}
                onClick={() => setNavCollapsed((v) => !v)}
                title={navCollapsed ? "Show File Navigator" : "Hide File Navigator"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                </svg>
              </button>

              {/* Focus Center (Collapse All Sidebars) */}
              <button
                className="btn-icon"
                onClick={focusDiff}
                title="Focus Workspace (Collapse Sidebars)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>

              {/* Restore Sidebars */}
              <button
                className="btn-icon"
                onClick={resetPanels}
                title="Restore Sidebars"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="3 9 3 3 9 3" /><polyline points="21 15 21 21 15 21" />
                  <line x1="3" y1="3" x2="10" y2="10" /><line x1="21" y1="21" x2="14" y2="14" />
                </svg>
              </button>





              <button
                className="btn-icon"
                style={aiReview?.findings?.length ? { color: '#818cf8' } : {}}
                onClick={() => setShowAIReviewPopup(true)}
                disabled={!aiReview?.findings?.length}
                title={aiReview?.findings?.length ? `AI Review (${aiReview.findings.length} findings)` : 'Run a review first'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </button>

              <button
                className="btn-icon"
                onClick={() => setShowAbout(true)}
                title="About AQS Inspect"
                style={{ color: "var(--accent-light, #6366f1)" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </button>

              <button className="btn-icon" onClick={() => setShowSettings(true)} title="Settings">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
              </button>
            </div>
          </div>

          {/* PR Controls */}
          <div className="panel">
            {/* Row 1: Source selector + PR dropdown + action triggers */}
            <div className="panel__section" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              
              <select
                className="input"
                style={{ maxWidth: 160, flex: '0 0 auto' }}
                value={repoType}
                onChange={(e) => handleRepoTypeChange(e.target.value)}
              >
                <option value="github">GitHub</option>
                <option value="azure">Azure DevOps</option>
              </select>

              {repoType === "azure" && config?.multiRepo && Array.isArray(config?.azureRepos) && config.azureRepos.length > 0 && (
                <select
                  className="input"
                  style={{ maxWidth: 180, flex: '0 0 auto', border: '1px solid var(--accent)', color: 'var(--accent-light)', fontWeight: '600' }}
                  value={selectedCustomer}
                  onChange={(e) => handleCustomerChange(e.target.value)}
                  title="Select Customer Repository"
                >
                  {config.azureRepos.map((repo, i) => (
                    <option key={i} value={repo.customer}>
                      🏢 {repo.customer}
                    </option>
                  ))}
                </select>
              )}

              {repoType === "github" && config?.multiRepoGithub && Array.isArray(config?.githubRepos) && config.githubRepos.length > 0 && (
                <select
                  className="input"
                  style={{ maxWidth: 180, flex: '0 0 auto', border: '1px solid var(--accent)', color: 'var(--accent-light)', fontWeight: '600' }}
                  value={selectedCustomer}
                  onChange={(e) => handleCustomerChange(e.target.value)}
                  title="Select Customer Repository"
                >
                  {config.githubRepos.map((repo, i) => (
                    <option key={i} value={repo.customer}>
                      🏢 {repo.customer}
                    </option>
                  ))}
                </select>
              )}

              <select
                className="input"
                value={selectedPrId}
                onChange={(e) => onSelectPR(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="">Select a pull request…</option>
                {prList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {`#${p.id} | ${String(p.title || "").slice(0, 75)}${String(p.title || "").length > 75 ? "…" : ""} | by ${p.createdBy || p.author || "Unknown"}`}
                  </option>
                ))}
              </select>

              <button className="btn primary" onClick={() => loadPRs()} disabled={prListLoading} style={{ flexShrink: 0 }}>
                {prListLoading ? "Loading…" : "Load PRs"}
              </button>

              <button
                className={`btn btn-primary-gradient ${showFilters ? "active" : ""}`}
                onClick={() => setShowFilters(v => !v)}
                style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}
                title="Toggle Filters"
              >
                <span>⚙ Filters</span>
              </button>

              <button
                className="btn btn-primary-gradient"
                onClick={() => { setSelectedPrId(""); setPrUrl(""); resetPrData(); }}
                disabled={!selectedPrId && !prUrl}
                style={{ flexShrink: 0 }}
              >
                Clear
              </button>
            </div>

            {/* Collapsible filters row */}
            {showFilters && (
              <div className="panel__section" style={{
                display: 'flex', gap: 8, alignItems: 'center',
                background: 'var(--bg-card)',
                border: '1px dashed var(--border-light)',
                color: 'var(--text-secondary'
                , padding: '10px 12px', borderRadius: 'var(--radius-md)', marginTop: 8
              }}>
                <select
                  className="input"
                  style={{ maxWidth: 180, flex: '1 1 auto' }}
                  value={filters.createdBy}
                  onChange={(e) => onSelectOwner(e.target.value)}
                >
                  <option value="">Filter by user</option>
                  {prOwners.map((owner) => (
                    <option key={owner} value={owner}>{owner}</option>
                  ))}
                </select>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>From:</span>
                  <input
                    className="input"
                    type="date"
                    value={filters.createdFrom}
                    onChange={async (e) => { const next = { ...filters, createdFrom: e.target.value }; setFilters(next); await loadPRs(next); }}
                    style={{ width: '140px', flex: '0 0 auto' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>To:</span>
                  <input
                    className="input"
                    type="date"
                    value={filters.createdTo}
                    onChange={async (e) => { const next = { ...filters, createdTo: e.target.value }; setFilters(next); await loadPRs(next); }}
                    style={{ width: '140px', flex: '0 0 auto' }}
                  />
                </div>
              </div>
            )}

            {/* Row 2: URL + Review Action */}
            <div className="panel__section" style={{ position: 'relative', display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                <input
                  className="input input-url"
                  style={{ width: '100%', paddingRight: '36px' }}
                  placeholder="PR URL (auto-filled from picker, or click edit to paste)"
                  value={prUrl}
                  onChange={(e) => setPrUrl(e.target.value)}
                  readOnly={!isPrUrlEditable}
                />
                <button
                  type="button"
                  className="btn ghost icon-only"
                  style={{
                    position: 'absolute',
                    right: '4px',
                    padding: '4px 8px',
                    height: '28px',
                    width: 'auto',
                    border: 'none',
                    background: 'transparent',
                    color: isPrUrlEditable ? 'var(--accent-light)' : 'var(--text-muted)',
                    cursor: 'pointer'
                  }}
                  onClick={() => setIsPrUrlEditable(prev => !prev)}
                  title={isPrUrlEditable ? "Lock URL (Make Readonly)" : "Edit URL manually"}
                >
                  {isPrUrlEditable ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  )}
                </button>
              </div>
              <button className="btn cta" onClick={reviewPullRequest} disabled={loading || aiLoading} id="review-pr-btn" style={{ flexShrink: 0 }}>
                {loading || aiLoading ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 13, height: 13, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                    Reviewing…
                  </span>
                ) : "Review Pull Request"}
              </button>
            </div>

            {error && (
              <div className="error-container" style={{ marginTop: 10 }}>
                <div className="error">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                  {error}
                </div>
                {rateLimitRetry && (
                  <button
                    className="btn primary"
                    onClick={rateLimitRetry}
                    disabled={aiLoading}
                  >
                    {aiLoading ? "Retrying…" : "↺ Retry"}
                  </button>
                )}
              </div>
            )}
            {statusMessage && !error && !reviewProgress?.total && (
              <div className="status-container">
                <div className="status">{statusMessage}</div>
              </div>
            )}
          </div>


          {/* Main Layout */}
          {(() => {
            const score = aiReview ? (calculatedScore !== null ? calculatedScore : (aiReview.score !== undefined ? aiReview.score : (aiReview.summary?.score !== undefined ? aiReview.summary.score : "N/A"))) : "N/A";
            const scoreNum = score === "N/A" ? 0 : Number(score);
            return (
              <div className={`workarea ${isDragging ? "dragging" : ""}`}>
                {/* Sidebar */}
                <aside
                  className={`sidebar ${navCollapsed ? "collapsed" : ""}`}
                  style={{
                    width: navCollapsed ? 0 : `${sidebarWidth}px`,
                    minWidth: navCollapsed ? 0 : `${sidebarWidth}px`,
                  }}
                >
                  <div className="sidebar__header">
                    <div className="sidebar__title-wrap">
                      <div className="sidebar__title">Files</div>
                      {actualFilesOnly.length > 0 && !navCollapsed && (
                        <div className="sidebar__subtitle">{actualFilesOnly.length} file{actualFilesOnly.length !== 1 ? 's' : ''} in PR</div>
                      )}
                    </div>
                    <div className="panel-controls">
                      {/* Maximize */}
                      <button
                        className="panel-control-btn"
                        onClick={() => {
                          setNavCollapsed(false);
                        }}
                        title="Maximize File Explorer"
                      >
                        ⛶
                      </button>
                      {/* Minimize */}
                      <button
                        className="panel-control-btn"
                        onClick={() => setNavCollapsed(true)}
                        title="Minimize File Explorer"
                      >
                        —
                      </button>
                    </div>
                  </div>

                  {!navCollapsed && (
                    <div className="sidebar-body">
                      {actualFilesOnly && actualFilesOnly.length > 0 ? (
                        <FileTree
                          nodes={impactedTree && impactedTree.length > 0 ? impactedTree : buildFileTree(actualFilesOnly)}
                          selectedFile={selectedFile}
                          statsByFile={statsByFile}
                          onFileSelect={(file) => {
                            setSelectedFile(file);
                            setShowDiffDialog(true);
                          }}
                        />
                      ) : (
                        <div style={{ padding: '28px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6e7681" strokeWidth="1.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                          <div style={{ fontSize: 12, color: '#6e7681', textAlign: 'center', lineHeight: 1.5 }}>
                            Review a pull request<br />to see files here
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </aside>

                {!navCollapsed && !showAIReviewPopup &&
                  !showDiffDialog &&
                  !reviewProgress  &&
                  (
                    <div
                      className="sidebar-resizer"
                      onMouseDown={initDrag}
                      style={{
                        width: '6px',
                        cursor: 'col-resize',
                        background: 'var(--bg-card)',
                        alignSelf: 'stretch',
                        flexShrink: 0,
                        margin: '0 -3px',
                        zIndex: 10,
                        position: 'relative'
                      }}
                    />
                  )}

                {/* Center Main Area */}
                <main className="main" style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  {/* PR Dashboard */}
                  <div className="pr-dashboard">
                    {/* Header Section */}
                    <div className="pr-dashboard-header" style={{ display: 'flex', flexDirection: 'column', gap: 14, borderBottom: '1px solid var(--border-dark)', paddingBottom: 20 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <h2 className="pr-dashboard-title" style={{ margin: 0 }}>
                          {activePr ? (
                            <>
                              <span style={{ color: "var(--accent-light)", marginRight: 8 }}>#{activePr.id || activePr.number}</span>
                              {activePr.title}
                            </>
                          ) : "Select a Pull Request to begin review"}
                        </h2>
                      </div>

                      {activePr && (
                        <>
                          <div className="pr-dashboard-meta" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, margin: 0 }}>
                            <span>👤 Created by: <strong>{activePr.createdBy || activePr.author || activePr.owner || "Unknown"}</strong></span>
                            <span>&bull;</span>
                            <span>📅 Created: <strong>{getFormattedDate(activePr.createdAt || activePr.creationDate || activePr.created_at || activePr.created)}</strong></span>
                            {activePr.sourceBranch && (
                              <>
                                <span>&bull;</span>
                                <span>⌥ Branch: <code>{activePr.sourceBranch}</code> &rarr; <code>{activePr.targetBranch || "main"}</code></span>
                              </>
                            )}
                            {activePr.status && (
                              <>
                                <span>&bull;</span>
                                <span className="diff-toolbar__badge" style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--bg-card)' }}>
                                  {String(activePr.status || activePr.state).toUpperCase()}
                                </span>
                              </>
                            )}
                          </div>

                          {activePr.description && (
                            <div className="pr-dashboard-description" style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', borderTop: '1px solid var(--border-dark)', paddingTop: 14, width: '100%' }}>
                              {activePr.description}
                            </div>
                          )}

                          {/* Actions Row */}
                          <div className="pr-dashboard-actions-row" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                            {aiReview && (
                              <>
                                <button className="btn btn-primary-gradient" onClick={() => setShowAIReviewPopup(true)} style={{ fontSize: 13, height: 36, padding: '0 14px' }} title="Open Full AI Review Details">
                                  🔍 Details
                                </button>

                                {!config?.email?.disabled && (
                                  <button className="btn btn-primary-gradient" onClick={sendReviewEmail} style={{ fontSize: 13, height: 36, padding: '0 12px' }} title="Send Review Email">
                                    📧 Email
                                  </button>
                                )}

                                <button className="btn btn-primary-gradient" onClick={exportReportPdf} style={{ fontSize: 13, height: 36, padding: '0 12px' }} title="Export PDF Report">
                                  📄 PDF
                                </button>
                              </>
                            )}

                            {isAcceptEnabled && (
                              <button className="btn success" onClick={() => performPRAction("accept")} style={{ fontSize: 13, height: 36, padding: '0 14px' }}>
                                ✓ Accept Pull Request
                              </button>
                            )}

                            {isRejectEnabled && (
                              <button className="btn danger" onClick={() => performPRAction(repoType === "azure" ? "abandon" : "reject")} style={{ fontSize: 13, height: 36, padding: '0 14px' }}>
                                ✕ {repoType === "azure" ? "Abandon" : "Reject"}
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {activePr ? (
                      <>
                        {/* Dashboard Grid */}
                        <div className="pr-dashboard-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12, marginTop: 20 }}>
                          {/* Files count */}
                          <div className="pr-dashboard-card" style={{ display: 'flex', flexDirection: 'column', padding: '10px 14px' }}>
                            <span className="pr-dashboard-card-label" style={{ fontSize: 10 }}>Files Impacted</span>
                            <span className="pr-dashboard-card-value" style={{ fontSize: 20 }}>{actualFilesOnly.length}</span>
                            <span style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {actualFilesOnly.filter(f => f.status === "added").length} added &bull; {actualFilesOnly.filter(f => f.status === "modified").length} modified
                            </span>
                          </div>

                          {/* Lines Stats */}
                          <div className="pr-dashboard-card" style={{ display: 'flex', flexDirection: 'column', padding: '10px 14px' }}>
                            <span className="pr-dashboard-card-label" style={{ fontSize: 10 }}>Code Changes</span>
                            <span className="pr-dashboard-card-value" style={{ fontSize: 20, color: "var(--green)" }}>
                              +{actualFilesOnly.reduce((acc, f) => acc + (f.additions || 0), 0)}
                              <span style={{ color: "var(--red)", marginLeft: 6 }}>
                                -{actualFilesOnly.reduce((acc, f) => acc + (f.deletions || 0), 0)}
                              </span>
                            </span>
                            <span style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 2 }}>Lines of code diff</span>
                          </div>

                          {/* AI Safety Score */}
                          <div className="pr-dashboard-card pr-dashboard-score-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', gap: 8 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                              <span className="pr-dashboard-card-label" style={{ fontSize: 10 }}>Safety Rating</span>
                              <span className="pr-dashboard-card-value" style={{ fontSize: 20 }}>
                                {aiReview ? `${score}` : "—"}
                              </span>
                            </div>
                            <div className="pr-dashboard-score-ring-wrap" style={{ position: 'relative', width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <svg width="42" height="42" viewBox="0 0 64 64">
                                <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="6" />
                                {aiReview ? (
                                  <circle
                                    cx="32" cy="32" r="26"
                                    fill="none"
                                    stroke={!isNaN(scoreNum) && scoreNum >= 80 ? "#10b981" : !isNaN(scoreNum) && scoreNum >= 50 ? "#f59e0b" : "#ef4444"}
                                    strokeWidth="6"
                                    strokeDasharray={2 * Math.PI * 26}
                                    strokeDashoffset={2 * Math.PI * 26 * (1 - scoreNum / 100)}
                                    strokeLinecap="round"
                                    transform="rotate(-90 32 32)"
                                    style={{ transition: "stroke-dashoffset 0.6s ease" }}
                                  />
                                ) : (
                                  <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" strokeDasharray="4,4" />
                                )}
                              </svg>
                            </div>
                          </div>

                          {/* Blockers */}
                          <div className="pr-dashboard-card" style={{ borderLeft: '4px solid var(--red)', padding: '10px 14px', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column' }}>
                            <span className="pr-dashboard-card-label" style={{ color: 'var(--red)', fontSize: 10 }}>Blockers</span>
                            <span className="pr-dashboard-card-value" style={{ fontSize: 20 }}>
                              {aiReview ? aiReview.findings.filter(f => String(f.severity).toLowerCase() === 'blocker' || String(f.severity).toLowerCase() === 'critical').length : "—"}
                            </span>
                            <span style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 2 }}>High severity</span>
                          </div>

                          {/* Majors */}
                          <div className="pr-dashboard-card" style={{ borderLeft: '4px solid var(--amber)', padding: '10px 14px', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column' }}>
                            <span className="pr-dashboard-card-label" style={{ color: 'var(--amber)', fontSize: 10 }}>Majors</span>
                            <span className="pr-dashboard-card-value" style={{ fontSize: 20 }}>
                              {aiReview ? aiReview.findings.filter(f => String(f.severity).toLowerCase() === 'major' || String(f.severity).toLowerCase() === 'warning').length : "—"}
                            </span>
                            <span style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 2 }}>Medium severity</span>
                          </div>

                          {/* Minors */}
                          <div className="pr-dashboard-card" style={{ borderLeft: '4px solid var(--sky)', padding: '10px 14px', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column' }}>
                            <span className="pr-dashboard-card-label" style={{ color: 'var(--sky)', fontSize: 10 }}>Minors</span>
                            <span className="pr-dashboard-card-value" style={{ fontSize: 20 }}>
                              {aiReview ? aiReview.findings.filter(f => String(f.severity).toLowerCase() === 'minor').length : "—"}
                            </span>
                            <span style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 2 }}>Low severity</span>
                          </div>

                          {/* Infos */}
                          <div className="pr-dashboard-card" style={{ borderLeft: '4px solid var(--text-muted)', padding: '10px 14px', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column' }}>
                            <span className="pr-dashboard-card-label" style={{ color: 'var(--text-muted)', fontSize: 10 }}>Infos</span>
                            <span className="pr-dashboard-card-value" style={{ fontSize: 20 }}>
                              {aiReview ? aiReview.findings.filter(f => String(f.severity).toLowerCase() === 'info').length : "—"}
                            </span>
                            <span style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 2 }}>Informational</span>
                          </div>
                        </div>

                        {/* Combined Two-Column Dashboard Content */}
                        <div className="pr-dashboard-content-split" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 20 }}>

                          {/* Left Column: Files Changed list */}
                          <div className="pr-dashboard-section" style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                            <span className="pr-dashboard-section-title" style={{ marginBottom: 10 }}>Files Changed ({actualFilesOnly.length})</span>
                            <div style={{ maxHeight: '340px', overflowY: 'auto', paddingRight: 4 }}>
                              <div className="pr-dashboard-files-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                                {actualFilesOnly.map(f => {
                                  const fileFindings = aiReview ? aiReview.findings.filter(fn => fn.filename === f.filename || fn.filename?.endsWith(baseName(f.filename))) : [];
                                  return (
                                    <div key={f.filename} className="pr-dashboard-file-item" onClick={() => { setSelectedFile(f); setShowDiffDialog(true); }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                        <span style={{ fontSize: 16 }}>📄</span>
                                        <span className="pr-dashboard-file-name" title={f.filename}>
                                          {baseName(f.filename)}
                                          {renderStatusBadge(f.status)}
                                        </span>
                                      </div>
                                      <div className="pr-dashboard-file-meta">
                                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>+{f.additions || 0} / -{f.deletions || 0}</span>
                                        {fileFindings.length > 0 && (
                                          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontWeight: 700 }}>
                                            {fileFindings.length} issue{fileFindings.length !== 1 ? 's' : ''}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>

                          {/* Right Column: Top Review Findings & Workflow */}
                          <div className="pr-dashboard-section" style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                            <span className="pr-dashboard-section-title" style={{ marginBottom: 10 }}>
                              Top Review Findings {aiReview && `(${aiReview.findings.length})`}
                            </span>

                            {aiReview ? (
                              <div style={{ maxHeight: '340px', overflowY: 'auto', paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {aiReview.findings && aiReview.findings.length > 0 ? (
                                  <div className="pr-dashboard-findings-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                                    {aiReview.findings.slice(0, 4).map((f, idx) => {
                                      const sev = String(f.severity || 'info').toLowerCase();
                                      return (
                                        <div
                                          key={idx}
                                          className={`pr-dashboard-finding-item ${sev}`}
                                          onClick={() => jumpToFinding(f)}
                                          style={{
                                            cursor: 'pointer',
                                            padding: '12px 14px',
                                            background: 'var(--bg-card)',
                                            border: '1px solid var(--border-dark)',
                                            borderRadius: 'var(--radius-md)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 6,
                                            transition: 'all 0.15s ease'
                                          }}
                                        >
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span className={`pr-status-badge ${sev}`} style={{ fontSize: 10, padding: '2px 6px', lineHeight: 1 }}>
                                              {String(f.severity || 'info').toUpperCase()}
                                            </span>
                                            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                              📄 {baseName(f.filename)}
                                            </span>
                                          </div>
                                          <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {f.title}
                                          </div>
                                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                            {f.explanation}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 12.5 }}>
                                    No compliance findings found in this Pull Request.
                                  </div>
                                )}

                                {aiReview.reviews && aiReview.reviews.length > 0 && (
                                  <div style={{ borderTop: '1px solid var(--border-dark)', paddingTop: 12, marginTop: 4 }}>
                                    <span className="pr-dashboard-section-title" style={{ marginBottom: 6, display: 'block' }}>Review Workflow Details</span>
                                    <ReviewWorkflowPanel data={aiReview} />
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="pr-dashboard-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'var(--bg-card)', border: '1px dashed var(--border-dark)', borderRadius: 'var(--radius-md)' }}>
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6e7681" strokeWidth="1.5" strokeLinecap="round" style={{ marginBottom: 8 }}><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                                <span style={{ fontSize: 12, color: '#8b949e', textAlign: 'center', lineHeight: 1.6 }}>
                                  No AI review findings loaded yet.<br />Click "Review Pull Request" to trigger analysis.
                                </span>
                              </div>
                            )}
                          </div>

                        </div>
                      </>
                    ) : (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '40px 0', opacity: 0.8 }}>
                        <div style={{ fontSize: 48 }}>🔍</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)' }}>Welcome to AQS Inspect Code Review Dashboard</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 420, lineHeight: 1.6 }}>
                          Select a Pull Request from the dropdown above, load its files, and click "Review Pull Request" to trigger security and architecture compliance reviews.
                        </div>
                      </div>
                    )}
                  </div>
                </main>
              </div>
            );
          })()}

          {/* AI Review Popup */}
          <AIReviewPopup
            open={showAIReviewPopup}
            onClose={() => setShowAIReviewPopup(false)}
            findings={scopedFindings}
            selectedFile={selectedFile}
            files={actualFilesOnly}
            aiReview={aiReview}
            activePr={activePr}
            onSelectFile={(f) => setSelectedFile(f)}
            onSelectFinding={(f) => jumpToFinding(f)}
            feedbackMap={feedbackMap}
            handleSaveFeedback={handleSaveFeedback}
          />

          <ReviewProgressDialog progress={reviewProgress} />

          {/* Full Screen Diff & Suggestions Dialog */}
          {showDiffDialog && selectedFile && (
            <div className="diff-dialog-overlay" role="dialog" aria-modal="true" onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowDiffDialog(false);
                setSelectedFile(null);
              }
            }}>
              <div className="diff-dialog-container">
                {/* Header */}
                <div className="diff-dialog-header">
                  <div className="diff-dialog-title">
                    <span style={{ fontSize: 18 }}>📄</span>
                    <span style={{ wordBreak: 'break-all' }}>{selectedFile.filename}</span>
                    <span className="diff-toolbar__badge" style={{ marginLeft: 8, background: 'var(--bg-card)', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                      {String(selectedFile.status || "modified").toUpperCase()}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button
                      className="btn"
                      onClick={() => {
                        setShowDiffDialog(false);
                        setSelectedFile(null);
                      }}
                      style={{
                        background: 'var(--bg-card)',
                        border: '1px dashed var(--border-light)',
                        color: 'var(--text-secondary)',
                        fontWeight: 600,
                        fontSize: 12,
                        padding: "6px 14px",
                        cursor: "pointer"
                      }}
                    >
                      ✕ Close View
                    </button>
                  </div>
                </div>

                {/* Body */}
                <div className="diff-dialog-body">
                  <div className="diff-dialog-viewer-pane">
                    <DiffViewer
                      file={selectedFile}
                      findings={scopedFindings}
                      onRequestFullFile={async (file, side) => {
                        if (!window.api?.getFileContent) {
                          throw new Error("Full file API not implemented yet (window.api.getFileContent)");
                        }
                        return await window.api.getFileContent({ filename: file.filename, side, repoType, prUrl, selectedPrId, customer: selectedCustomer });
                      }}
                    />
                  </div>

                  {/* Right: findings list */}
                  <div className="diff-dialog-findings-pane">
                    <div className="diff-dialog-findings-header">
                      AI Suggestions for this file ({scopedFindings.length})
                    </div>
                    <div className="diff-dialog-findings-list">
                      {scopedFindings.length === 0 ? (
                        <div style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
                          ✓ No coding standard violations or security risks found in this file.
                        </div>
                      ) : (
                        scopedFindings.map((f, idx) => {
                          const sev = String(f.severity || 'info').toLowerCase();
                          const isActive = activeFindingKey === makeFindingKey(f);
                          return (
                            <div
                              key={`${makeFindingKey(f)}-${idx}`}
                              className={`reviewcard ${sev}`}
                              style={{
                                cursor: 'pointer',
                                outline: isActive ? '2px solid rgba(99,102,241,0.7)' : 'none',
                                transform: isActive ? 'translateY(-1px)' : 'none',
                                boxShadow: isActive ? '0 4px 16px rgba(99,102,241,0.2)' : undefined,
                                transition: 'all 0.15s ease',
                                margin: 0
                              }}
                              onClick={() => {
                                const key = makeFindingKey(f);
                                setActiveFindingKey(key);
                                const el = findingAnchorMapRef.current.get(key);
                                if (el?.scrollIntoView) {
                                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }
                              }}
                            >
                              <div className="reviewcard__hdr">
                                <span className="sev">{String(f.severity || 'info').toUpperCase()}</span>
                                <span className="title">{f.title || 'Finding'}</span>
                              </div>
                              <div className="reviewcard__body" style={{ fontSize: 12, lineHeight: 1.4 }}>{f.explanation || ''}</div>
                              {f.recommendation && (
                                <div style={{ marginTop: 6, fontSize: 11, padding: '4px 8px', borderRadius: 4, background: 'var(--bg-card)', borderLeft: '2px solid var(--accent)', color: '#a5b4fc' }}>
                                  💡 {f.recommendation}
                                </div>
                              )}

                              {/* Feedback Loop Controls */}
                              <div className="reviewcard__feedback" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 8, marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                                <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginRight: 'auto' }}>Helpful?</span>
                                {(() => {
                                  const key = makeFindingKey(f);
                                  const savedFeedback = feedbackMap[key]?.status;
                                  return (
                                    <>
                                      <button
                                        className="btn btn-feedback-accept"
                                        style={{
                                          padding: '4px 10px',
                                          fontSize: 11,
                                          background: savedFeedback === 'accepted' ? 'var(--green-soft)' : 'var(--bg-card)',
                                          borderColor: savedFeedback === 'accepted' ? 'var(--green-border)' : 'var(--border-dark)',
                                          color: savedFeedback === 'accepted' ? 'var(--green)' : 'var(--text-secondary)',
                                          cursor: 'pointer'
                                        }}
                                        onClick={() => handleSaveFeedback(f, 'accepted')}
                                      >
                                        👍 Yes
                                      </button>
                                      <button
                                        className="btn btn-feedback-reject"
                                        style={{
                                          padding: '4px 10px',
                                          fontSize: 11,
                                          background: savedFeedback === 'rejected' ? 'var(--red-soft)' : 'var(--bg-card)',
                                          borderColor: savedFeedback === 'rejected' ? 'var(--red-border)' : 'var(--border-dark)',
                                          color: savedFeedback === 'rejected' ? 'var(--red)' : 'var(--text-secondary)',
                                          cursor: 'pointer'
                                        }}
                                        onClick={() => handleSaveFeedback(f, 'rejected')}
                                      >
                                        👎 No
                                      </button>
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
    </div>
  );
}


/* =========================================================
   AI Review Popup
========================================================= */
function AIReviewPopup({ open, onClose, findings, selectedFile, files, aiReview, activePr, onSelectFile, onSelectFinding, feedbackMap = {}, handleSaveFeedback }) {
  // ✅ Hooks MUST run unconditionally (even when open === false)

  const safeFindings = useMemo(() => (Array.isArray(findings) ? findings : []), [findings]);

  const sortedFindings = useMemo(() => {
    return [...safeFindings].sort((a, b) => {
      const fileA = a.filename || '';
      const fileB = b.filename || '';
      if (fileA !== fileB) {
        return fileA.localeCompare(fileB);
      }
      return (a.line || 0) - (b.line || 0);
    });
  }, [safeFindings]);

  const impactedSet = useMemo(() => {
    const s = new Set();
    safeFindings.forEach((f) => {
      if (f?.filename) s.add(normPath(f.filename));
    });
    return s;
  }, [safeFindings]);

  const filesWithFindings = useMemo(() => {
    const list = Array.isArray(files) ? files : [];
    return list.filter((f) => impactedSet.has(normPath(f.filename)));
  }, [files, impactedSet]);

  const [localIndex, setLocalIndex] = useState(0);

  useEffect(() => {
    // reset selection when popup opens or scope changes
    if (!open) return;
    setLocalIndex(0);
  }, [open, selectedFile?.filename, sortedFindings.length]);

  const fileReasoningText = useMemo(() => {
    const map = aiReview?.fileReasoning || {};
    if (!selectedFile || !map || !Object.keys(map).length) return null;
    if (map[selectedFile.filename]) return map[selectedFile.filename];
    const base = baseName(selectedFile.filename || "");
    for (const k of Object.keys(map)) {
      if (k === selectedFile.filename) return map[k];
      if (k.endsWith(base)) return map[k];
    }
    return null;
  }, [aiReview, selectedFile]);

  // ✅ Now it's safe to conditionally render
  if (!open) return null;

  const canNav = sortedFindings.length > 0;

  const goPrev = () => {
    if (!sortedFindings.length) return;
    const nextIndex = (localIndex - 1 + sortedFindings.length) % sortedFindings.length;
    setLocalIndex(nextIndex);
    onSelectFinding?.(sortedFindings[nextIndex]);
  };

  const goNext = () => {
    if (!sortedFindings.length) return;
    const nextIndex = (localIndex + 1) % sortedFindings.length;
    setLocalIndex(nextIndex);
    onSelectFinding?.(sortedFindings[nextIndex]);
  };

  return (
    <div className="ai-overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ai-modal">
        {/* Modal header */}
        <div className="ai-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="ai-title">
              <div className="ai-title-icon">🧠</div>
              AI Review
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: 'var(--bg-card)', border: '1px solid var(--border-dark)', color: 'var(--text-primary)' }}>
                {selectedFile ? baseName(selectedFile.filename) : 'All files'}
              </span>
              <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: 'var(--bg-card)', border: '1px solid var(--border-dark)', color: 'var(--text-primary)', fontWeight: 700 }}>
                {sortedFindings.length} finding{sortedFindings.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="btn btn-primary-gradient" onClick={goPrev} disabled={!canNav}>↑ Prev</button>
            <button className="btn btn-primary-gradient" onClick={goNext} disabled={!canNav}>↓ Next</button>
            <div className="topbar__divider" />
            <button className="btn btn-primary-gradient" onClick={onClose} title="Close (Esc)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {/* PR Details Metadata Bar */}
        {activePr && (
          <div className="ai-pr-metadata-bar">
            <div className="ai-pr-meta-item" style={{ flex: '1 1 240px', minWidth: 0 }}>
              <span className="meta-label">Pull Request</span>
              <span className="meta-value font-bold" title={activePr.title} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                <span className="pr-number">#{activePr.id || activePr.number}</span> {activePr.title}
              </span>
            </div>
            <div className="ai-pr-meta-item">
              <span className="meta-label">Author</span>
              <span className="meta-value">
                👤 {activePr.createdBy || activePr.author || activePr.owner || "Unknown"}
              </span>
            </div>
            <div className="ai-pr-meta-item">
              <span className="meta-label">Created At</span>
              <span className="meta-value">
                📅 {getFormattedDate(activePr.createdAt || activePr.creationDate || activePr.created_at || activePr.created)}
              </span>
            </div>
            {activePr.sourceBranch && (
              <div className="ai-pr-meta-item">
                <span className="meta-label">Branches</span>
                <span className="meta-value code-branch" title={`${activePr.sourceBranch} → ${activePr.targetBranch || 'main'}`}>
                  ⌥ {activePr.sourceBranch} &rarr; {activePr.targetBranch || "main"}
                </span>
              </div>
            )}
            {(activePr.status || activePr.state) && (
              <div className="ai-pr-meta-item">
                <span className="meta-label">Status</span>
                <span className={`pr-status-badge ${String(activePr.status || activePr.state).toLowerCase()}`}>
                  {String(activePr.status || activePr.state).toUpperCase()}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="ai-body">
          {/* Left: file list */}
          <div className="ai-left">
            <div className="ai-section-title">Impacted Files</div>
            <div className="ai-filelist">
              <button className={`btn btn-primary-gradient ${!selectedFile ? 'active' : ''}`} onClick={() => onSelectFile?.(null)}>
                All files
                <span style={{ float: 'right', fontSize: 11, opacity: 0.7 }}>{safeFindings.length}</span>
              </button>

              {filesWithFindings.map((f) => {
                const fileCount = safeFindings.filter(fn => fn.filename === f.filename || fn.filename?.endsWith(baseName(f.filename))).length;
                return (
                  <button
                    key={f.filename}
                    className={`btn btn-primary-gradient ${selectedFile?.filename === f.filename ? 'active' : ''}`}
                    onClick={() => onSelectFile?.(f)}
                    title={f.filename}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {baseName(f.filename)}
                      {renderStatusBadge(f.status)}
                    </span>
                    <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 6, flexShrink: 0 }}>{fileCount}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: findings list */}
          <div className="ai-right">
            <div className="ai-section-title">Findings</div>

            {!sortedFindings.length && (
              <div style={{ padding: '32px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.3 }}>✓</div>
                <div className="muted">No findings for this scope.</div>
              </div>
            )}

            {sortedFindings.map((f, idx) => {
              const sev = String(f.severity || 'info').toLowerCase();
              const isActive = idx === localIndex;
              const showHeader = !selectedFile && (idx === 0 || f.filename !== sortedFindings[idx - 1].filename);
              return (
                <React.Fragment key={`${makeFindingKey(f)}-${idx}`}>
                  {showHeader && (
                    <div className="ai-finding-group-header">
                      <span className="folder-icon">📂</span>
                      <span className="file-path">{f.filename}</span>
                    </div>
                  )}
                  <div
                    className={`reviewcard ${sev}`}
                    style={{
                      cursor: 'pointer',
                      outline: isActive ? '2px solid rgba(99,102,241,0.55)' : 'none',
                      transform: isActive ? 'translateY(-1px)' : 'none',
                      boxShadow: isActive ? '0 4px 16px rgba(99,102,241,0.15)' : undefined,
                      transition: 'all 0.15s ease',
                    }}
                    onClick={() => { setLocalIndex(idx); onSelectFinding?.(f); }}
                  >
                    <div className="reviewcard__hdr">
                      <span className="sev">{String(f.severity || 'info').toUpperCase()}</span>
                      <span className="title">{f.title || 'Finding'}</span>
                      {isActive && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#818cf8', flexShrink: 0 }}>↵ active</span>}
                    </div>
                    <div className="reviewcard__body">{f.explanation || ''}</div>
                    {f.recommendation && (
                      <div style={{ marginTop: 8, fontSize: 12, padding: '6px 10px', borderRadius: 6, background: 'var(--bg-card)', borderLeft: '2px solid var(--accent)', color: '#a5b4fc' }}>
                        💡 {f.recommendation}
                      </div>
                    )}

                    {/* Feedback Loop Controls */}
                    <div className="reviewcard__feedback" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 8, marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                      <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginRight: 'auto' }}>Helpful?</span>
                      {(() => {
                        const key = makeFindingKey(f);
                        const savedFeedback = feedbackMap[key]?.status;
                        return (
                          <>
                            <button
                              className="btn btn-feedback-accept"
                              style={{
                                padding: '4px 10px',
                                fontSize: 11,
                                background: savedFeedback === 'accepted' ? 'var(--green-soft)' : 'var(--bg-card)',
                                borderColor: savedFeedback === 'accepted' ? 'var(--green-border)' : 'var(--border-dark)',
                                color: savedFeedback === 'accepted' ? 'var(--green)' : 'var(--text-secondary)',
                                cursor: 'pointer'
                              }}
                              onClick={() => handleSaveFeedback(f, 'accepted')}
                            >
                              👍 Yes
                            </button>
                            <button
                              className="btn btn-feedback-reject"
                              style={{
                                padding: '4px 10px',
                                fontSize: 11,
                                background: savedFeedback === 'rejected' ? 'var(--red-soft)' : 'var(--bg-card)',
                                borderColor: savedFeedback === 'rejected' ? 'var(--red-border)' : 'var(--border-dark)',
                                color: savedFeedback === 'rejected' ? 'var(--red)' : 'var(--text-secondary)',
                                cursor: 'pointer'
                              }}
                              onClick={() => handleSaveFeedback(f, 'rejected')}
                            >
                              👎 No
                            </button>
                          </>
                        );
                      })()}
                    </div>
                    {f.matchText && (
                      <div className="reviewcard__meta" style={{ marginTop: 8 }}>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>{String(f.matchText).slice(0, 75)}{String(f.matchText).length > 75 ? '…' : ''}</span>
                      </div>
                    )}
                  </div>
                </React.Fragment>
              );
            })}

            {selectedFile && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', color: '#6e7681', marginBottom: 10 }}>File Reasoning</div>
                {fileReasoningText ? (
                  <div style={{ fontSize: 12.5, lineHeight: 1.6, color: '#8b949e', whiteSpace: 'pre-wrap' }}>{fileReasoningText}</div>
                ) : (
                  <div className="muted">No reasoning available for this file.</div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="ai-footer">
          <span className="muted">Click a finding to jump to its location in the diff</span>
        </div>
      </div>
    </div>
  );
}

function ReviewProgressDialog({ progress }) {
  if (!progress || !progress.total) return null;
  const percentage = Math.round((progress.current / progress.total) * 100);
  return (
    <div className="progress-overlay" aria-live="polite" role="status">
      <div className="progress-modal">
        <div className="progress-modal__icon">🧠</div>
        <div className="progress-modal__title">Analyzing Code</div>
        <div className="progress-modal__subtitle">
          Reviewing file <strong style={{ color: '#e6edf3' }}>{progress.current}</strong> of{' '}
          <strong style={{ color: '#e6edf3' }}>{progress.total}</strong>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${Math.max(4, percentage)}%` }} />
        </div>
        <div className="progress-modal__pct">{percentage}%</div>
        <div className="progress-modal__file">{progress.file || 'Preparing…'}</div>
      </div>
    </div>

  );
}

/* =========================================================
   Split Diff Viewer (paired rows + smart collapse + inline reviews)
   + Finding anchor registration + highlighting
========================================================= */
function SplitDiffViewer({ file, findings, activeIndex, anchorsRef, anchorKeyToIndex, findingAnchorMapRef, activeFindingKey }) {
  const fileFindings = useMemo(() => {
    return (findings || []).filter((f) => fileMatches(f.filename, file.filename));
  }, [findings, file.filename]);

  const hunks = useMemo(() => splitIntoHunksUnified(file.patch || ""), [file.patch]);

  const COLLAPSE_THRESHOLD = 14;
  const KEEP_HEAD = 3;
  const KEEP_TAIL = 3;

  const [expandedFolds, setExpandedFolds] = useState(() => new Set());
  const toggleFold = (foldId) => {
    setExpandedFolds((prev) => {
      const next = new Set(prev);
      if (next.has(foldId)) next.delete(foldId);
      else next.add(foldId);
      return next;
    });
  };

  // reset anchor registries per render
  anchorsRef.current = [];
  anchorKeyToIndex.current = new Map();
  if (findingAnchorMapRef?.current) findingAnchorMapRef.current = new Map();

  return (
    <div className="diff-surface">
      <div className="sticky file-header">{file.filename}</div>

      {hunks.map((h, hIdx) => {
        const paired = buildSplitRowsFromHunk(h.header, h.lines).map((r, idx) => ({ ...r, origIndex: idx }));
        const displayItems = buildSmartCollapsedItems(paired, hIdx, expandedFolds, {
          threshold: COLLAPSE_THRESHOLD,
          keepHead: KEEP_HEAD,
          keepTail: KEEP_TAIL,
        });

        return (
          <div key={hIdx} className="hunk">
            <div className="sticky hunk-header">{h.header}</div>

            <div className="split-head">
              <div className="coltitle">Old</div>
              <div className="coltitle">New</div>
            </div>

            {displayItems.map((item, idx) => {
              if (item.type === "fold") {
                return (
                  <div key={`fold-${item.foldId}-${idx}`} className="fold-row">
                    <button className="fold-btn" onClick={() => toggleFold(item.foldId)}>
                      Show {item.count} unchanged lines
                    </button>
                  </div>
                );
              }

              const r = item.row;
              const joined = `${r.left || ""}\n${r.right || ""}`;
              const matched = fileFindings.filter((f) => f.matchText && joined.includes(f.matchText));

              return (
                <div key={`${hIdx}-${r.origIndex}-${idx}`} className={`split-row ${r.kind}`}>
                  <div className="cell old">
                    <div className="ln">{r.oldNo ?? ""}</div>
                    <div className="code">{r.left || ""}</div>
                  </div>

                  <div className="cell neu">
                    <div className="ln">{r.newNo ?? ""}</div>
                    <div className="code">{r.right || ""}</div>
                  </div>

                  {r.noNewline && <div className="no-newline-row">\\ No newline at end of file</div>}

                  {matched.map((f, fIdx) => {
                    const findingKey = makeFindingKey(f);
                    const anchorKey = `${file.filename}|${hIdx}|${r.origIndex}|${fIdx}`;
                    const anchorIndex = anchorsRef.current.length;
                    anchorKeyToIndex.current.set(anchorKey, anchorIndex);

                    const isActive = findingKey && activeFindingKey && findingKey === activeFindingKey;

                    return (
                      <div
                        key={anchorKey}
                        data-finding-key={findingKey}
                        ref={(el) => {
                          if (!el) return;
                          anchorsRef.current[anchorIndex] = el;

                          // Register first occurrence of this finding for jumpToFinding()
                          if (findingAnchorMapRef?.current && findingKey && !findingAnchorMapRef.current.has(findingKey)) {
                            findingAnchorMapRef.current.set(findingKey, el);
                          }
                        }}
                        className={`inline-comment-row ${anchorIndex === activeIndex ? "issue-active" : ""} ${isActive ? "finding-active" : ""}`}
                      >
                        <InlineComment finding={f} />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function InlineComment({ finding }) {
  const sev = String(finding.severity || "info").toLowerCase();
  return (
    <div className={`inline-comment ${sev}`}>
      <div className="inline-hdr">
        <span className="sev">{sev.toUpperCase()}</span>
        <span className="ttl">{finding.title}</span>
      </div>
      <div className="inline-body">{finding.explanation}</div>
    </div>
  );
}

/* =========================================================
   Review normalization (client-side safety net)
========================================================= */
function normalizeReview(res, files) {
  const out = res && typeof res === "object" ? res : {};
  const findings = Array.isArray(out.findings) ? out.findings : [];

  // Normalize severities to engine categories and uplift critical runtime issues
  const sevMap = { high: "Blocker", critical: "Blocker", medium: "Major", low: "Minor", warning: "Major", info: "Info" };

  const criticalKeywords = [
    "divide by zero",
    "division by zero",
    "null pointer",
    "nullreference",
    "null reference",
    "runtime error",
    "uncaught exception",
    "syntax error",
    "missing cdb",
    "missing cdb file",
    "missing cdb artifact",
    "stack overflow",
    "segmentation fault"
  ];

  const normalizedFindings = findings.map((f) => {
    const raw = (f.severity || f.level || "").toString().toLowerCase();
    let sev = sevMap[raw] || (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Info");
    const text = `${f.title || ""} ${f.explanation || f.details || ""} ${f.matchText || f.match || ""}`.toLowerCase();
    for (const kw of criticalKeywords) {
      if (text.includes(kw)) {
        sev = "Blocker";
        break;
      }
    }

    // Basic recommendation heuristics
    let recommendation = f.recommendation || "";
    if (!recommendation) {
      if (sev === "Blocker") recommendation = "Fix immediately: investigate runtime errors and add defensive checks.";
      else if (sev === "Major") recommendation = "Address this issue: refactor or validate inputs and add tests.";
      else if (sev === "Minor") recommendation = "Consider improvement: clean up or add validations as needed.";
      else recommendation = "Review and assess relevance; add tests or defensive handling if needed.";
    }

    return {
      title: f.title || "Finding",
      explanation: f.explanation || f.details || "",
      severity: sev,
      filename: f.filename || f.file || "",
      matchText: f.matchText || f.match || "",
      recommendation,
    };
  });

  if (files?.length === 1) {
    normalizedFindings.forEach((f) => {
      if (!f.filename) f.filename = files[0].filename;
    });
  }

  return {
    score: out.score ?? 0,
    severity: out.severity ?? "",
    confidence: out.confidence ?? 0,
    findings: normalizedFindings,
    fileReasoning: out.fileReasoning || {},
  };
}

/* =========================================================
   Production-grade diff pairing engine (existing)
========================================================= */
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
      rows.push({ kind: "mod", left: delBuf[i].text, right: addBuf[i].text, oldNo: delBuf[i].no, newNo: addBuf[i].no });
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
      delBuf.push({ text: line, no: oldNo });
      oldNo += 1;
      continue;
    }
    if (prefix === "+") {
      addBuf.push({ text: line, no: newNo });
      newNo += 1;
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

function buildSmartCollapsedItems(rows, hunkIndex, expandedFolds, { threshold, keepHead, keepTail }) {
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
    if (runLen <= threshold) {
      for (let k = i; k < j; k++) items.push({ type: "row", row: rows[k] });
    } else {
      const foldId = `${hunkIndex}-${i}-${j - 1}`;
      const expanded = expandedFolds.has(foldId);
      if (expanded) {
        for (let k = i; k < j; k++) items.push({ type: "row", row: rows[k] });
      } else {
        for (let k = i; k < i + keepHead; k++) items.push({ type: "row", row: rows[k] });
        items.push({ type: "fold", foldId, count: runLen - keepHead - keepTail });
        for (let k = j - keepTail; k < j; k++) items.push({ type: "row", row: rows[k] });
      }
    }
    i = j;
  }
  return items;
}
