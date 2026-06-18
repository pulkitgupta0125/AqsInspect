import { useState } from "react";

export default function SetupScreen({ onConfigured }) {
  const [repoType, setRepoType] = useState("github");

  // GitHub state
  const [githubToken, setGithubToken] = useState("");
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepo, setGithubRepo] = useState("");

  // Azure DevOps state
  const [azureOrg, setAzureOrg] = useState("");
  const [azureProject, setAzureProject] = useState("");
  const [azureRepo, setAzureRepo] = useState("");
  const [azurePat, setAzurePat] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (repoType === "github") {
        if (!githubToken || !githubOwner || !githubRepo) {
          setError("All GitHub fields (Token, Owner, and Repository) are required.");
          setLoading(false);
          return;
        }

        await window.api.saveConfig({
          repoType: "github",
          github: {
            token: githubToken.trim(),
            owner: githubOwner.trim(),
            repo: githubRepo.trim(),
            enableAccept: true,
            enableReject: true
          },
          githubToken: githubToken.trim()
        });
      } else {
        if (!azureOrg || !azureProject || !azureRepo || !azurePat) {
          setError("All Azure DevOps fields (Organization, Project, Repository, and PAT) are required.");
          setLoading(false);
          return;
        }

        await window.api.saveConfig({
          repoType: "azure",
          azure: {
            org: azureOrg.trim(),
            project: azureProject.trim(),
            repoIdOrName: azureRepo.trim(),
            pat: azurePat.trim(),
            apiVersion: "7.1",
            enableAccept: true,
            enableReject: true
          }
        });
      }

      const newConfig = await window.api.getConfig();
      onConfigured(newConfig);
    } catch (err) {
      console.error("Setup failed:", err);
      setError("Failed to save configuration. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="setup-container">
      <div className="panel" style={{
        width: "min(500px, 92vw)",
        padding: "32px",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-xl)",
        border: "1px solid var(--border-dark)",
        background: "#ffffff",
        backdropFilter: "blur(12px)",
        animation: "fadeSlideIn 0.3s ease"
      }}>
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div style={{ fontSize: "42px", marginBottom: "8px" }}>🔍</div>
          <h2 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.5px" }}>
            Welcome to AQS Inspect
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "13px", marginTop: "6px" }}>
            Let's configure your repository provider to start reviewing pull requests.
          </p>
        </div>

        {error && (
          <div style={{
            background: "var(--red-soft)",
            border: "1px solid var(--red-border)",
            color: "var(--red)",
            padding: "12px",
            borderRadius: "var(--radius-sm)",
            fontSize: "12px",
            marginBottom: "20px",
            animation: "fadeIn 0.2s ease"
          }}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Tab Selector */}
          <div style={{ display: "flex", gap: "8px", background: "rgba(0,0,0,0.2)", padding: "4px", borderRadius: "var(--radius-md)" }}>
            <button
              type="button"
              onClick={() => { setRepoType("github"); setError(""); }}
              className={`btn ${repoType === "github" ? "primary" : "ghost"}`}
              style={{ flex: 1, height: "34px", borderRadius: "var(--radius-sm)" }}
            >
              GitHub
            </button>
            <button
              type="button"
              onClick={() => { setRepoType("azure"); setError(""); }}
              className={`btn ${repoType === "azure" ? "primary" : "ghost"}`}
              style={{ flex: 1, height: "34px", borderRadius: "var(--radius-sm)" }}
            >
              Azure DevOps
            </button>
          </div>

          {repoType === "github" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                  GitHub Personal Access Token (PAT)
                </label>
                <input
                  type="password"
                  placeholder="ghp_..."
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  className="input"
                  style={{ width: "100%" }}
                  required
                />
              </div>

              <div style={{ display: "flex", gap: "12px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Owner / Organization
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. facebook"
                    value={githubOwner}
                    onChange={(e) => setGithubOwner(e.target.value)}
                    className="input"
                    style={{ width: "100%" }}
                    required
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Repository Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. react"
                    value={githubRepo}
                    onChange={(e) => setGithubRepo(e.target.value)}
                    className="input"
                    style={{ width: "100%" }}
                    required
                  />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                  Organization Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. my-org"
                  value={azureOrg}
                  onChange={(e) => setAzureOrg(e.target.value)}
                  className="input"
                  style={{ width: "100%" }}
                  required
                />
              </div>

              <div style={{ display: "flex", gap: "12px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Project Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. my-project"
                    value={azureProject}
                    onChange={(e) => setAzureProject(e.target.value)}
                    className="input"
                    style={{ width: "100%" }}
                    required
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Repository
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. my-repo"
                    value={azureRepo}
                    onChange={(e) => setAzureRepo(e.target.value)}
                    className="input"
                    style={{ width: "100%" }}
                    required
                  />
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                  Personal Access Token (PAT)
                </label>
                <input
                  type="password"
                  placeholder="Azure DevOps PAT"
                  value={azurePat}
                  onChange={(e) => setAzurePat(e.target.value)}
                  className="input"
                  style={{ width: "100%" }}
                  required
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn primary cta"
            style={{
              marginTop: "8px",
              height: "42px",
              fontSize: "14px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              width: "100%"
            }}
          >
            {loading ? "Saving Config..." : "💾 Save & Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
