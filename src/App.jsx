import { useEffect, useMemo, useRef, useState } from "react";
import SetupScreen from "./SetupScreen";
import SettingsScreen from "./SettingsScreen";
import "./styles.css";
// Files visible in navigator
import FileTree from "./components/FileTree"
import { buildFileTree } from "./utils/fileTree"
import DiffViewer from "./components/DiffViewer";
import AIInsightsPanel from "./components/AIInsightsPanel";
import ReviewWorkflowPanel from "./components/ReviewWorkflowPanel";

/* -----------------------------
   Helpers: path matching
------------------------------ */
const normPath = (p) => (p || "").replace(/\\/g, "/").trim();

const baseName = (p) => {
  const n = normPath(p);
  const parts = n.split("/");
  return parts[parts.length - 1] || n;
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


export default function App() {
  const [topSearch, setTopSearch] = useState("");
  /* =============================
     Core state
  ============================= */
  const [repoType, setRepoType] = useState("github");
  const [filters, setFilters] = useState({ createdFrom: "", createdTo: "", createdBy: "", status: "all" });
  const [prList, setPrList] = useState([]);
  // Full cached list of PRs downloaded from provider
  const [prListAll, setPrListAll] = useState([]);
  const [prListLoading, setPrListLoading] = useState(false);
  const [selectedPrId, setSelectedPrId] = useState("");
  const [prUrl, setPrUrl] = useState("");

  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");

  const [config, setConfig] = useState(null);
  const [checkingConfig, setCheckingConfig] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const [prMeta, setPrMeta] = useState(null);
  const [files, setFiles] = useState([]);

  const [unifiedDiff, setUnifiedDiff] = useState("");
  const [aiReview, setAiReview] = useState(null);

  // Findings filter chips (critical/warning/info/all) still supported
  const [activeFilter, setActiveFilter] = useState("all");

  // Pane collapse states (keep your existing UX)
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [reviewCollapsed, setReviewCollapsed] = useState(false);

  // ✅ NEW: AI review popup
  const [showAIReviewPopup, setShowAIReviewPopup] = useState(false);

  // ✅ NEW: Review progress dialog
  const [reviewProgress, setReviewProgress] = useState(null);

  // ✅ NEW: Rate limit retry handler
  const [rateLimitRetry, setRateLimitRetry] = useState(null);

  // ✅ NEW: Impact filter toggle (navigator shows only impacted files)
  const [showImpactedOnly, setShowImpactedOnly] = useState(true);

  // ✅ NEW: Active finding highlight (when user clicks a finding in popup)
  const [activeFindingKey, setActiveFindingKey] = useState("");

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

  const searchQuery = useMemo(() => String(topSearch || "").trim().toLowerCase(), [topSearch]);

  const prOwners = useMemo(() => {
    return [...new Set(prList.map((p) => p.createdBy || "").filter(Boolean))].sort();
  }, [prList]);

  const fileTree = useMemo(() => {
    if (!Array.isArray(files)) return [];

    const actualFiles = files.filter((f) => f?.filename && f.filename.includes("."));
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
  }, [files, searchQuery, allFindings]);

  // impactedTree will be computed after visibleFiles is available (see below)

	const [selectedFile, setSelectedFile] = useState(null)


  const impactedSet = useMemo(() => {
    const s = new Set();
    (allFindings || []).forEach((f) => {
      if (f?.filename) s.add(normPath(f.filename));
    });
    return s;
  }, [allFindings]);


  //const fileTree = buildFileTree(files);
  
  const visibleFiles = useMemo(() => {
    if (!showImpactedOnly) return files;
    return (files || []).filter((f) => impactedSet.has(normPath(f.filename)));
  }, [files, impactedSet, showImpactedOnly]);

  const impactedTree = useMemo(() => {
    // show only files that have been reviewed
    const reviewed = (files || []).filter((f) => f.reviewed);
    if (!reviewed.length) return [];
    return buildFileTree(reviewed);
  }, [aiReview, files]);

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
    for (const file of files) {
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
  }, [files, allFindings]);

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
  (files || []).forEach((f) => {
    const key = f?.filename || "";
    const s = fileSummary[key] || { critical: 0, warning: 0, info: 0, total: 0 };
    m[key] = {
      ...s,
      additions: f.additions || 0,
      deletions: f.deletions || 0,
    };
  });
  return m;
}, [files, fileSummary]);  

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
    setReviewCollapsed(true);
  };
  const resetPanels = () => {
    setNavCollapsed(false);
    setReviewCollapsed(false);
  };

  // Keyboard shortcuts (kept)
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey) return;
      if (e.key === "\\") setNavCollapsed((v) => !v);
      if (e.key === "/") setReviewCollapsed((v) => !v);
      if (e.key === "Enter") focusDiff();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* =============================
     Load config once
  ============================= */
  useEffect(() => {
    (async () => {
      try {
        const cfg = await window.api.getConfig();
        setConfig(cfg || {});
        setRepoType(cfg?.repoType || "github");
      } finally {
        setCheckingConfig(false);
      }
    })();
  }, []);

  const viewMode = useMemo(() => {
    if (checkingConfig) return "loading";
    if (showSettings) return "settings";
    const needsSetup =
      repoType === "azure"
        ? !(config?.azure?.org && config?.azure?.project && config?.azure?.repoIdOrName && config?.azure?.pat)
        : !(config?.githubToken || config?.github?.token) || !(config?.github?.owner && config?.github?.repo);
    if (needsSetup) return "setup";
    return "main";
  }, [checkingConfig, showSettings, config?.githubToken, config?.azure, repoType]);

  /* =============================
     PR list + diff + AI review actions
  ============================= */
  // loadPRs accepts optional overrideFilters so the UI can trigger reloads immediately
    const loadPRs = async (overrideFilters) => {
    setPrListLoading(true);
    setError(null);
    //setStatusMessage("");

    const effectiveFilters = overrideFilters || filters;

    if (repoType === "github") {
      const g = config?.github || {};
      const t = config?.githubToken || g.token;
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
      const a = config?.azure || {};
      if (!(a.org && a.project && a.repoIdOrName && a.pat)) {
        setPrListLoading(false);
        setError("Azure DevOps settings are missing. Please configure org/project/repo/PAT in Settings.");
        return;
      }
    }

    try {
      const res = await window.api.listPullRequests({ repoType, filters: effectiveFilters });
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
    const pr = prList.find((p) => p.id === id) || prListAll.find((p) => p.id === id);
    if (pr?.url) setPrUrl(pr.url);
    // Eagerly fetch PR details to capture developer and creation date for reports
    (async () => {
      try {
        const idOrUrl = pr?.url || id;
        if (!idOrUrl) return;
        const det = await window.api.getPullRequestDetails({ repoType, prUrlOrId: idOrUrl });
        if (det?.ok && det.pr) setPrMeta(det.pr);
      } catch (e) {
        // ignore non-fatal
        console.warn('Failed to fetch PR details for selection', e?.message || e);
      }
    })();
  };

  const fetchDiff = async () => {
    setError(null);
    setPrMeta(null);
    setFiles([]);
    setSelectedFile(null);
    setUnifiedDiff("");
    setAiReview(null);
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
      if (!config?.githubToken && !config?.github?.token) {
        setError("GitHub Token is missing. Please configure it in Settings.");
        return;
      }
    } else {
      const a = config?.azure || {};
      if (!(a.org && a.project && a.repoIdOrName && a.pat)) {
        setError("Azure DevOps settings are missing. Please configure org/project/repo/PAT in Settings.");
        return;
      }
    }

    try {
      setLoading(true);
      const payload =
        repoType === "github"
          ? { prUrl, repoType, token: config.githubToken || config.github?.token }
          : { prUrl: selectedPrId || prUrl, repoType };

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
      const payload = repoType === "github" ? { prUrl, repoType, token: config.githubToken || config.github?.token } : { prUrl: selectedPrId || prUrl, repoType };
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
      setReviewProgress({ current: 0, total: fetchedFiles.length, file: "" });

      const aggregatedFindings = [];

      for (let i = 0; i < fetchedFiles.length; i++) {
        const file = fetchedFiles[i];
        // update processing flag
        setFiles((prev) => prev.map((p) => (p.filename === file.filename ? { ...p, processing: true } : p)));
        setStatusMessage(`Reviewing ${i + 1}/${fetchedFiles.length}: ${file.filename}`);
        setReviewProgress({ current: i + 1, total: fetchedFiles.length, file: file.filename || "" });

        try {
          const res = await window.api.runAIReview({ unifiedDiff: file.patch || "", files: [file] });
          const normalized = normalizeReview(res, [file]);
          // attach filename to findings if missing
          const fileFindings = (normalized.findings || []).map((ff) => ({ ...ff, filename: ff.filename || file.filename }));

          aggregatedFindings.push(...fileFindings);

          setFiles((prev) => {
            const next = prev.map((p) => (p.filename === file.filename ? { ...p, reviewed: true, processing: false, findings: fileFindings } : p));
            // auto-select the first reviewed file if none selected yet
            if (!selectedFile) {
              const reviewedFile = next.find((x) => x.filename === file.filename);
              if (reviewedFile) {
                setSelectedFile(reviewedFile);
              }
            }
            return next;
          });
        } catch (e) {
          console.error("Per-file review failed:", e);
          setFiles((prev) => prev.map((p) => (p.filename === file.filename ? { ...p, reviewed: false, processing: false, error: e?.message } : p)));
        }
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
    if (!smtpConfig?.host || !smtpConfig?.port || !smtpConfig?.from) {
      setError("SMTP email configuration is missing or incomplete. Please configure it in Settings.");
      return;
    }

    try {
      // Fetch PR details (to get developer name and PR dates)
      const prDetailsRes = await window.api.getPullRequestDetails({ repoType, prUrlOrId: selectedPrId || prUrl });
      const prDetails = prDetailsRes?.pr || {};

      // Fetch user email from repo if 'to' is not configured
      let toAddress = smtpConfig.to;
      if (!toAddress) {
        const emailRes = await window.api.getUserEmail({ repoType });
        if (emailRes?.ok) {
          toAddress = emailRes.email;
        } else {
          setError("Email 'to' address is not configured and could not be fetched from repository. Please configure it in Settings.");
          return;
        }
      }

      const subject = `Code Review: ${prDetails?.title || prMeta?.title || prUrl}`;
      const report = composeReviewReport(prDetails, aiReview);

      const result = await window.api.sendEmail({
        subject,
        body: report,
        to: toAddress,
        from: smtpConfig.from,
        replyTo: smtpConfig.replyTo,
        config: smtpConfig
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

  const exportReport = async () => {
    if (!aiReview) {
      setError("Generate an AI review before exporting report.");
      return;
    }
    try {
      const prDetailsRes = await window.api.getPullRequestDetails({ repoType, prUrlOrId: selectedPrId || prUrl });
      const prDetails = prDetailsRes?.pr || {};
      const md = composeReviewReport(prDetails, aiReview);
      const filename = `AQS_Review_PR_${prDetails?.number || 'report'}.md`;
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
      const prDetailsRes = await window.api.getPullRequestDetails({ repoType, prUrlOrId: selectedPrId || prUrl });
      const prDetails = prDetailsRes?.pr || prMeta || {};
      const md = composeReviewReport(prDetails, aiReview);
      const filename = `AQS_Review_PR_${prDetails?.number || 'report'}.pdf`;
      const saved = await window.api.saveReportPdf({ defaultFilename: filename, content: md });
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
    try {
      const res = await window.api.performPRAction({ repoType, prUrlOrId: prUrl, action });
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

      const res = await window.api.runAIReview({ unifiedDiff, files });
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
    if (fileObj) setSelectedFile(fileObj);

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
      {viewMode === "loading" && <div className="page pad">Loading…</div>}

      {viewMode === "setup" && (
        <SetupScreen
          onConfigured={async () => {
            const cfg = await window.api.getConfig();
            setConfig(cfg || {});
            setRepoType(cfg?.repoType || "github");
          }}
        />
      )}

      {viewMode === "settings" && (
        <SettingsScreen
          onBack={async () => {
            const cfg = await window.api.getConfig();
            setConfig(cfg || {});
            setRepoType(cfg?.repoType || "github");
            setShowSettings(false);
          }}
        />
      )}

      {viewMode === "main" && (
        <>
          {/* Top bar */}
          <div className="topbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width:36, height:36, borderRadius:8, background:'linear-gradient(135deg,#0ea5e9,#2563eb)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:800 }}>AI</div>
                <div className="topbar__title">
                  <div className="brand">AQS Inspect</div>
                  <div className="subtitle">PR Diff & AI Review</div>
                </div>
              </div>

              <div className="topbar__search">
                <input placeholder="Search files, findings, or PRs…" value={topSearch} onChange={(e) => setTopSearch(e.target.value)} />
              </div>
            </div>

            <div className="topbar__actions">
              <button className="btn" onClick={focusDiff} title="Collapse panels to focus on diff">
                ⤢ Focus Diff
              </button>
              <button className="btn" onClick={resetPanels} title="Restore panels">
                ⤡ Restore
              </button>

              {/* ✅ AI Review Popup Button */}
              <button
                className="btn success"
                onClick={() => setShowAIReviewPopup(true)}
                disabled={!aiReview?.findings?.length}
                title="Open AI Review"
              >
                🧠 AI Review
              </button>

              <button className="btn" onClick={() => setShowSettings(true)}>
                ⚙ Settings
              </button>

              <div className="topbar__avatar" title={config?.user || 'User'}>
                {config?.user ? String(config.user).slice(0,2).toUpperCase() : 'AQ'}
              </div>
            </div>
          </div>

          {/* PR Controls */}
          <div className="panel">
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <select
                className="input"
                style={{ maxWidth: 180 }}
                value={repoType}
                onChange={(e) => {
                  setRepoType(e.target.value);
                  setSelectedPrId("");
                  setPrList([]);
                }}
              >
                <option value="github">GitHub</option>
                <option value="azure">Azure DevOps</option>
              </select>

              <select
                className="input"
                style={{ maxWidth: 140 }}
                value={filters.createdBy}
                onChange={(e) => onSelectOwner(e.target.value)}
              >
                <option value="">Filter by user</option>
                {prOwners.map((owner) => (
                  <option key={owner} value={owner}>
                    {owner}
                  </option>
                ))}
              </select>

              <input
                className="input"
                type="date"
                value={filters.createdFrom}
                onChange={async (e) => {
                  const next = { ...filters, createdFrom: e.target.value };
                  setFilters(next);
                  await loadPRs(next);
                }}
                style={{ maxWidth: 140 }}
                placeholder="From"
                title="Filter from date"
              />
              <input
                className="input"
                type="date"
                value={filters.createdTo}
                onChange={async (e) => {
                  const next = { ...filters, createdTo: e.target.value };
                  setFilters(next);
                  await loadPRs(next);
                }}
                style={{ maxWidth: 140 }}
                placeholder="To"
                title="Filter to date"
              />

              <button className="btn primary" onClick={() => loadPRs()} disabled={prListLoading}>
                {prListLoading ? "Loading PRs…" : "Load PRs"}
              </button>
            </div>

            <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <select className="input" value={selectedPrId} onChange={(e) => onSelectPR(e.target.value)}>
                <option value="">Select a PR…</option>
                {prList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {`#${p.id} — ${String(p.title || "").slice(0, 90)}${
                      String(p.title || "").length > 90 ? "…" : ""
                    } (${p.status})`}
                  </option>
                ))}
              </select>

              <button
                className="btn"
                onClick={() => {
                  setSelectedPrId("");
                  setPrUrl("");
                }}
                disabled={!selectedPrId && !prUrl}
                title="Clear selection"
              >
                Clear
              </button>
            </div>

            <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
              <input
                className="input"
                placeholder="PR URL (auto-filled from picker, editable)"
                value={prUrl}
                onChange={(e) => setPrUrl(e.target.value)}
              />

              <button className="btn primary" onClick={reviewPullRequest} disabled={loading || aiLoading}>
                {loading || aiLoading ? "Reviewing…" : "Review Pull Request"}
              </button>
            </div>

            {error && (
              <div className="error-container">
                <div className="error">{error}</div>
                {rateLimitRetry && (
                  <button 
                    className="btn primary" 
                    onClick={rateLimitRetry}
                    disabled={aiLoading}
                    style={{ marginTop: 8 }}
                  >
                    {aiLoading ? "Retrying…" : "🔄 Retry"}
                  </button>
                )}
              </div>
            )}
            {statusMessage && !error && !reviewProgress?.total && (
              <div className="status-container">
                <div className="status">{statusMessage}</div>
              </div>
            )}

            {/* Filter + Jump (kept) */}
            {aiReview && (
              <div className="toolbar">
                <div className="chips">
                  <button className={`chip ${activeFilter === "all" ? "active" : ""}`} onClick={() => setActiveFilter("all")}>
                    All
                  </button>
                  <button
                    className={`chip ${activeFilter === "critical" ? "active" : ""}`}
                    onClick={() => setActiveFilter("critical")}
                  >
                    🔴 Critical
                  </button>
                  <button
                    className={`chip ${activeFilter === "warning" ? "active" : ""}`}
                    onClick={() => setActiveFilter("warning")}
                  >
                    🟡 Warning
                  </button>
                  <button className={`chip ${activeFilter === "info" ? "active" : ""}`} onClick={() => setActiveFilter("info")}>
                    🟢 Info
                  </button>
                </div>

                <div className="jump">
                  <span className="muted">{anchorsRef.current.length ? `${issueIndex + 1}/${anchorsRef.current.length}` : "0/0"}</span>
                  <button className="btn" onClick={goPrevIssue} disabled={!anchorsRef.current.length}>
                    ⬆ Prev
                  </button>
                  <button className="btn" onClick={goNextIssue} disabled={!anchorsRef.current.length}>
                    ⬇ Next
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Main Layout */}
          <div className="workarea">
            {/* Sidebar */}
            <aside className={`sidebar ${navCollapsed ? "collapsed" : ""}`}>
              <div className="sidebar__header">
                <div>
                  <h2>Reviewed files</h2>
                  <p>Browse files reviewed from the selected PR.</p>
                </div>
                <button
                  className="btn"
                  onClick={() => setNavCollapsed((v) => !v)}
                  title={navCollapsed ? "Maximize navigator" : "Minimize navigator"}
                  aria-label={navCollapsed ? "Maximize navigator" : "Minimize navigator"}
                  style={{ minWidth: 36, padding: "8px 10px" }}
                >
                  {navCollapsed ? "+" : "−"}
                </button>
              </div>

              {!navCollapsed && (
                <div className="sidebar-body">
                  {files && files.length > 0 ? (
                    <FileTree
                      nodes={impactedTree && impactedTree.length > 0 ? impactedTree : buildFileTree(files)}
                      selectedFile={selectedFile}
                      statsByFile={statsByFile}
                      onFileSelect={(file) => setSelectedFile(file)}
                    />
                  ) : (
                    <div style={{ padding: 18 }} className="muted">
                      Review a pull request to populate files here.
                    </div>
                  )}
                </div>
              )}
            </aside>

            {/* Diff + (optional) review pane remains but is now secondary since popup is primary */}
            <main className="main" style={{ minHeight: 0 }}>
              <div className="diffpane" style={{ minHeight: 0 }}>
                {selectedFile ? (
                  <DiffViewer
					  file={selectedFile}
					  findings={scopedFindings}
					  onRequestFullFile={async (file, side) => {
						// Hook for "View full latest source"
						// If you wire backend IPC, call it here:
						// return await window.api.getFileContent({ filename: file.filename, side, repoType, prUrl })
						if (!window.api?.getFileContent) {
						  throw new Error("Full file API not implemented yet (window.api.getFileContent)");
						}
						return await window.api.getFileContent({ filename: file.filename, side, repoType, prUrl, selectedPrId });
					  }}
					/>
                ) : (
                  <div className="empty">Select a file to view diff</div>
                )}
              </div>

              {/* Keep existing right pane collapsible; can be used for summary or left empty */}
              <div className={`reviewpane ${reviewCollapsed ? "collapsed" : ""}`}>
                <div className={`pane-title ${reviewCollapsed ? "is-collapsed" : ""}`}>
                  {!reviewCollapsed && <span>AI Review</span>}
                  <button
                    className="pane-toggle"
                    onClick={() => setReviewCollapsed((v) => !v)}
                    title={reviewCollapsed ? "Maximize AI pane" : "Minimize AI pane"}
                    aria-label={reviewCollapsed ? "Maximize AI pane" : "Minimize AI pane"}
                  >
                    {reviewCollapsed ? "+" : "−"}
                  </button>
                </div>

                {!reviewCollapsed && (
                  <div className="pane-body review-body">
                    {aiReview ? (
                      <>
                        <AIInsightsPanel
                          findings={aiReview.findings || []}
                          onFilterChange={(sev) => setActiveFilter(sev.toLowerCase())}
                        />

                        <ReviewWorkflowPanel data={aiReview} />

                        <div className="reviewcard info" style={{ marginTop: 14 }}>
                          <div className="reviewcard__hdr">
                            <span className="sev">SUMMARY</span>
                            <span className="title">Findings</span>
                          </div>
                          <div className="reviewcard__body">
                            Total findings: <b>{aiReview.findings.length}</b>
                            <br />
                            Scope: <b>{selectedFile ? baseName(selectedFile.filename) : "All files"}</b>
                          </div>
                        </div>

                        <button
                          className="btn success"
                          style={{ marginTop: 12, width: "100%" }}
                          onClick={() => setShowAIReviewPopup(true)}
                        >
                          Open Full AI Review
                        </button>

                        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                          <button className="btn primary" onClick={sendReviewEmail}>
                            📧 Compose Review Email
                          </button>
                          <button className="btn" onClick={exportReportPdf}>
                            📄 Export Report
                          </button>
                          <button className="btn success" onClick={() => performPRAction("accept")}>
                            ✅ Accept PR
                          </button>
                          <button className="btn danger" onClick={() => performPRAction(repoType === "azure" ? "abandon" : "reject")}>
                            {repoType === "azure" ? "Abandon PR" : "Reject PR"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="muted">No AI findings yet. Click “Review Pull Request”.</div>
                    )}
                  </div>
                )}
              </div>
            </main>
          </div>

          {/* ✅ AI Review Popup */}
          <AIReviewPopup
            open={showAIReviewPopup}
            onClose={() => setShowAIReviewPopup(false)}
            findings={scopedFindings}
            selectedFile={selectedFile}
            files={files}
            aiReview={aiReview}
            onSelectFile={(f) => setSelectedFile(f)}
            onSelectFinding={(f) => jumpToFinding(f)}
          />

          <ReviewProgressDialog progress={reviewProgress} />
        </>
      )}
    </div>
  );
}

/* =========================================================
   AI Review Popup
========================================================= */
function AIReviewPopup({ open, onClose, findings, selectedFile, files, aiReview, onSelectFile, onSelectFinding }) {
  // ✅ Hooks MUST run unconditionally (even when open === false)

  const safeFindings = useMemo(() => (Array.isArray(findings) ? findings : []), [findings]);

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
  }, [open, selectedFile?.filename, safeFindings.length]);

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

  const canNav = safeFindings.length > 0;

  const goPrev = () => {
    if (!safeFindings.length) return;
    const nextIndex = (localIndex - 1 + safeFindings.length) % safeFindings.length;
    setLocalIndex(nextIndex);
    onSelectFinding?.(safeFindings[nextIndex]);
  };

  const goNext = () => {
    if (!safeFindings.length) return;
    const nextIndex = (localIndex + 1) % safeFindings.length;
    setLocalIndex(nextIndex);
    onSelectFinding?.(safeFindings[nextIndex]);
  };

  return (
    <div className="ai-overlay" role="dialog" aria-modal="true">
      <div className="ai-modal">
        <div className="ai-header">
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div className="ai-title">AI Review</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Scope: <b>{selectedFile ? baseName(selectedFile.filename) : "All files"}</b> • Findings:{" "}
              <b>{safeFindings.length}</b>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn" onClick={goPrev} disabled={!canNav}>
              ⬆ Prev
            </button>
            <button className="btn" onClick={goNext} disabled={!canNav}>
              ⬇ Next
            </button>
            <button className="btn" onClick={onClose}>
              ✖ Close
            </button>
          </div>
        </div>

        <div className="ai-body">
          <div className="ai-left">
            <div className="ai-section-title">Impacted Files</div>
            <div className="ai-filelist">
              <button className={`ai-file ${selectedFile ? "" : "active"}`} onClick={() => onSelectFile?.(null)}>
                All files
              </button>

              {filesWithFindings.map((f) => (
                <button
                  key={f.filename}
                  className={`ai-file ${selectedFile?.filename === f.filename ? "active" : ""}`}
                  onClick={() => onSelectFile?.(f)}
                  title={f.filename}
                >
                  {baseName(f.filename)}
                </button>
              ))}
            </div>
          </div>

          <div className="ai-right">
            <div className="ai-section-title">Findings</div>

            {!safeFindings.length && <div className="muted">No findings for this scope.</div>}

            {safeFindings.map((f, idx) => {
              const sev = String(f.severity || "info").toLowerCase();
              return (
                <div
                  key={`${makeFindingKey(f)}-${idx}`}
                  className={`reviewcard ${sev}`}
                  style={{
                    cursor: "pointer",
                    outline: idx === localIndex ? "2px solid rgba(37,99,235,.5)" : "none",
                  }}
                  onClick={() => {
                    setLocalIndex(idx);
                    onSelectFinding?.(f);
                  }}
                >
                  <div className="reviewcard__hdr">
                    <span className="sev">{String(f.severity || "info").toUpperCase()}</span>
                    <span className="title">{f.title || "Finding"}</span>
                  </div>
                  <div className="reviewcard__body">{f.explanation || ""}</div>
                  <div className="reviewcard__meta">
                    File: <b>{baseName(f.filename || "(not specified)")}</b>
                    {f.matchText ? (
                      <>
                        {" "}
                        • Match:{" "}
                        <span className="muted">
                          {String(f.matchText).slice(0, 60)}
                          {String(f.matchText).length > 60 ? "…" : ""}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}

              {/* Per-file reasoning (from AI review) */}
              {selectedFile && (
                <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>File Reasoning</div>
                  {fileReasoningText ? (
                    <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{fileReasoningText}</div>
                  ) : (
                    <div className="muted">No file-specific reasoning available for this file.</div>
                  )}
                </div>
              )}
          </div>
        </div>

        <div className="ai-footer">
          <div className="muted" style={{ fontSize: 12 }}>
            Tip: Click a finding to jump to the code + inline highlight.
          </div>
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
        <div style={{ fontSize: 18, fontWeight: 800 }}>Review in progress</div>
        <div style={{ marginTop: 10, color: "#475569" }}>
          Reviewing <strong>{progress.current}</strong> of <strong>{progress.total}</strong> files
        </div>
        <div style={{ marginTop: 18 }} className="progress-bar">
          <div className="progress-fill" style={{ width: `${percentage}%` }} />
        </div>
        <div style={{ marginTop: 10, color: "#475569" }}>{percentage}% complete</div>
        <div style={{ marginTop: 14, opacity: 0.8, fontSize: 13 }}>
          The current file under review is: {progress.file || "Preparing..."}
        </div>
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
