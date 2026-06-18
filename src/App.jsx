import React, { useEffect, useMemo, useState } from "react";
import SetupScreen from "./screens/SetupScreen";
import SettingsScreen from "./screens/SettingsScreen";
import AboutScreen from "./screens/AboutScreen";
import DashboardScreen from "./screens/DashboardScreen";
import "./styles.css";

export default function App() {
  const [repoType, setRepoType] = useState("github");
  const [config, setConfig] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [checkingConfig, setCheckingConfig] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  // Return a warning UI if the application is not running inside Electron
  if (!window.api) {
    return (
      <div className="setup-container" style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "#0f172a", color: "#f8fafc" }}>
        <div className="panel" style={{
          width: "min(550px, 92vw)",
          padding: "40px",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-xl)",
          border: "1px solid var(--border-dark)",
          background: "#1e293b",
          textAlign: "center"
        }}>
          <div style={{ fontSize: "56px", marginBottom: "16px" }}>⚠️</div>
          <h2 style={{ fontSize: "24px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.5px", marginBottom: "12px" }}>
            Browser Environment Warning
          </h2>
          <p style={{ color: "#94a3b8", fontSize: "14px", lineHeight: "1.6", margin: "0 0 24px 0" }}>
            AQS Inspect has been opened in a standard web browser. To access your local repository files, perform security reviews, and save configurations, this application must run inside the <strong>Electron desktop shell</strong>.
          </p>
          <div style={{
            background: "#0f172a",
            padding: "16px 20px",
            borderRadius: "var(--radius-md)",
            border: "1px solid #334155",
            textAlign: "left",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: "12.5px",
            color: "#38bdf8",
            marginBottom: "24px",
            whiteSpace: "pre-wrap"
          }}>
            # Start the application correctly:<br />
            npm run dev
          </div>
          <p style={{ color: "#64748b", fontSize: "11px", margin: 0 }}>
            Run the command above in your project folder using your terminal, which will launch both the web server and the Electron shell window automatically.
          </p>
        </div>
      </div>
    );
  }

  useEffect(() => {
    (async () => {
      try {
        const cfg = await window.api.getConfig();
        setConfig(cfg || {});
        setRepoType(cfg?.repoType || "github");
        if (cfg?.multiRepo && Array.isArray(cfg?.azureRepos) && cfg.azureRepos.length > 0) {
          setSelectedCustomer(cfg.selectedCustomer || cfg.azureRepos[0].customer);
        } else if (cfg?.multiRepoGithub && Array.isArray(cfg?.githubRepos) && cfg.githubRepos.length > 0) {
          setSelectedCustomer(cfg.selectedCustomerGithub || cfg.githubRepos[0].customer);
        }
      } finally {
        setCheckingConfig(false);
      }
    })();
  }, []);

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

  const viewMode = useMemo(() => {
    if (checkingConfig) return "loading";
    if (showSettings) return "settings";

    let needsSetup = false;
    if (repoType === "azure") {
      if (config?.multiRepo) {
        if (!config?.azureRepos || config.azureRepos.length === 0) {
          needsSetup = true;
        } else {
          const active = activeAzureRepo;
          needsSetup = !(active?.org && active?.project && active?.repoIdOrName && active?.pat);
        }
      } else {
        needsSetup = !(config?.azure?.org && config?.azure?.project && config?.azure?.repoIdOrName && config?.azure?.pat);
      }
    } else {
      if (config?.multiRepoGithub) {
        if (!config?.githubRepos || config.githubRepos.length === 0) {
          needsSetup = true;
        } else {
          const active = activeGithubRepo;
          needsSetup = !(active?.owner && active?.repo && (active?.token || config?.githubToken));
        }
      } else {
        needsSetup = !(config?.githubToken || config?.github?.token) || !(config?.github?.owner && config?.github?.repo);
      }
    }

    if (needsSetup) return "setup";
    return "main";
  }, [checkingConfig, showSettings, config?.githubToken, config?.azure, config?.multiRepo, config?.azureRepos, config?.multiRepoGithub, config?.githubRepos, repoType, activeAzureRepo, activeGithubRepo]);

  if (viewMode === "loading") {
    return (
      <div className="progress-overlay" style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <div className="progress-modal" style={{ textAlign: "center" }}>
          <div className="progress-modal__icon">🔍</div>
          <div className="progress-modal__title" style={{ marginTop: 10 }}>Checking Configuration...</div>
        </div>
      </div>
    );
  }

  if (showAbout) {
    return <AboutScreen onClose={() => setShowAbout(false)} />;
  }

  if (viewMode === "setup") {
    return (
      <SetupScreen
        onConfigured={(cfg) => {
          setConfig(cfg || {});
          setRepoType(cfg?.repoType || "github");
        }}
      />
    );
  }

  if (viewMode === "settings") {
    return (
      <SettingsScreen
        onBack={async () => {
          const cfg = await window.api.getConfig();
          setConfig(cfg || {});
          setRepoType(cfg?.repoType || "github");
          setShowSettings(false);
        }}
      />
    );
  }

  return (
    <DashboardScreen
      config={config}
      setConfig={setConfig}
      repoType={repoType}
      setRepoType={setRepoType}
      selectedCustomer={selectedCustomer}
      setSelectedCustomer={setSelectedCustomer}
      setShowSettings={setShowSettings}
      setShowAbout={setShowAbout}
    />
  );
}
