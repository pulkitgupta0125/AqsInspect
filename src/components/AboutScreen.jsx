import React, { useState } from "react";

export default function AboutScreen({ onClose }) {
  const [activeStep, setActiveStep] = useState(null);

  const workflowSteps = [
    {
      num: "1",
      title: "PR Trigger",
      desc: "Developer creates a PR in GitHub or Azure DevOps",
      detail: "Hooks retrieve branch diffs and repository details."
    },
    {
      num: "2",
      title: "Context Fetch",
      desc: "Fetches changes & IFS ERP metadata",
      detail: "Leverages OData/REST connections for context-aware risk checks."
    },
    {
      num: "3",
      title: "Rule Scan",
      desc: "Runs deterministic compliance checks",
      detail: "Enforces mandatory AQS guidelines and folder hierarchies."
    },
    {
      num: "4",
      title: "AI Compliance",
      desc: "LLM analyzes patterns & potential defects",
      detail: "Hybrid MCP engine verifies logic flaws and suggests fixes."
    },
    {
      num: "5",
      title: "Audit & Merge",
      desc: "Developer reviews and merges with logs",
      detail: "Updates the repository; writes audit events for complete traceability."
    }
  ];

  return (
    <div className="pres-screen about-screen">
      {/* Header */}
      <div className="pres-screen__header">
        <div className="pres-screen__title-block">
          <span className="brand-accent">About AQS Inspect</span>
          <span className="divider">—</span>
          <span>Enterprise Compliance & AI Code Review</span>
        </div>
        <div className="pres-screen__actions">
          <button className="btn btn-primary" onClick={onClose}>
            Back to Dashboard
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="slide-content about-content">
        
        {/* Top Section: Overview & Metrics */}
        <div className="slide-grid-top">
          
          {/* Card 1: What is AQS Inspect */}
          <div className="slide-card bottleneck-card about-card-left">
            <div className="slide-card__header">
              <span className="icon accent-color">ℹ️</span>
              <h3>WHAT IS AQS INSPECT?</h3>
            </div>
            
            <div className="slide-card__body about-text-body">
              <p style={{ margin: "0 0 10px 0", fontSize: "12.5px", lineHeight: "1.5", color: "#cbd5e1" }}>
                <strong>AQS Inspect</strong> is an enterprise-grade desktop utility designed to streamline pull request reviews, enforce mandatory coding standards, and perform context-aware static code inspections.
              </p>
              <p style={{ margin: "0 0 10px 0", fontSize: "12.5px", lineHeight: "1.5", color: "#cbd5e1" }}>
                By combining <strong>deterministic rule-based checks</strong> with <strong>LLM-guided hybrid reasoning</strong>, AQS Inspect ensures codebases strictly adhere to AQS Guidelines, helps developers catch critical bugs early, and automatically logs complete audit trails for security.
              </p>
              <p style={{ margin: 0, fontSize: "12.5px", lineHeight: "1.5", color: "#cbd5e1" }}>
                Its specialized integration with <strong>IFS ERP</strong> endpoints allows developers to analyze database and metadata impacts dynamically before code is ever merged.
              </p>
            </div>
          </div>

          {/* Card 2: Core Benefits */}
          <div className="slide-card transformation-card">
            <div className="slide-card__header">
              <span className="icon success-color">✅</span>
              <h3>CORE BENEFITS</h3>
            </div>
            
            <div className="slide-card__body about-benefits-body" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="bottleneck-item">
                <div className="bottleneck-item__meta" style={{ backgroundColor: "rgba(16, 185, 129, 0.12)", color: "#10b981" }}>Standardization</div>
                <div className="bottleneck-item__text">
                  <strong>Mandatory AQS Compliance</strong>: Automatically enforces standardized guidelines, naming conventions, and best coding practices across all files.
                </div>
              </div>
              <div className="bottleneck-item">
                <div className="bottleneck-item__meta" style={{ backgroundColor: "rgba(16, 185, 129, 0.12)", color: "#10b981" }}>Defect Reduction</div>
                <div className="bottleneck-item__text">
                  <strong>Bug Detection</strong>: Flags potential runtime errors, security vulnerabilities, and design violations instantly.
                </div>
              </div>
              <div className="bottleneck-item">
                <div className="bottleneck-item__meta" style={{ backgroundColor: "rgba(16, 185, 129, 0.12)", color: "#10b981" }}>Seamless Flow</div>
                <div className="bottleneck-item__text">
                  <strong>Workflow Integration</strong>: Fits directly into the developer review loop, reducing reliance on manual oversight and coordination.
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Performance Metrics */}
          <div className="slide-card quality-card">
            <div className="slide-card__header">
              <span className="icon warning-color">📈</span>
              <h3>IMPACT METRICS</h3>
            </div>
            
            <div className="slide-card__body transformation-body">
              <div className="time-comparison">
                <div className="time-box manual">
                  <div className="time-box__label">MANUAL REVIEW</div>
                  <div className="time-box__value">4.0</div>
                  <div className="time-box__unit">hours</div>
                </div>
                
                <div className="time-arrow">
                  <span className="arrow-graphic">➔</span>
                </div>
                
                <div className="time-box aqs">
                  <div className="time-box__label">AQS INSPECT</div>
                  <div className="time-box__value">~5</div>
                  <div className="time-box__unit">minutes</div>
                </div>
              </div>

              <div className="highlight-badge" style={{ marginTop: "15px" }}>
                <div className="highlight-badge__metric">98%</div>
                <div className="highlight-badge__text">
                  <h4>EFFORT REDUCTION</h4>
                  <p>Catching up to 90% of defects early with 100% guidelines compliance.</p>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Bottom Section: Workflow Timeline */}
        <div className="slide-workflow">
          <div className="slide-workflow__header">
            <span className="icon">⚙️</span>
            <h3>HOW AQS INSPECT INTEGRATES INTO DEVELOPMENT WORKFLOW</h3>
          </div>
          
          <div className="workflow-flow">
            {workflowSteps.map((step, idx) => (
              <React.Fragment key={step.num}>
                <div 
                  className={`workflow-step ${activeStep === idx ? "active" : ""}`}
                  onMouseEnter={() => setActiveStep(idx)}
                  onMouseLeave={() => setActiveStep(null)}
                >
                  <div className="workflow-step__num">{step.num}</div>
                  <div className="workflow-step__title">{step.title}</div>
                  <div className="workflow-step__desc">{step.desc}</div>
                  
                  {/* Tooltip detail shown on active hover */}
                  <div className="workflow-step__tooltip">
                    {step.detail}
                  </div>
                </div>
                {idx < workflowSteps.length - 1 && (
                  <div className="workflow-connector">➔</div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
