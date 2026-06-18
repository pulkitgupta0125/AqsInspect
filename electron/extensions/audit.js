/**
 * Audit Extension
 * Captures MCP reasoning events and action history for enterprise traceability.
 */

const auditLog = [];

function recordAuditEvent(type, payload = {}) {
  const event = {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    timestamp: new Date().toISOString(),
    payload
  };

  auditLog.push(event);
  return event;
}

function summarizeAuditTrail({ limit = 50 } = {}) {
  return auditLog.slice(-limit);
}

module.exports = {
  recordAuditEvent,
  summarizeAuditTrail
};
