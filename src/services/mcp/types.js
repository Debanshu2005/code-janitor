/**
 * Shared MCP defaults and helpers.
 */

const DEFAULT_START_TIMEOUT_MS = 30_000;
const DEFAULT_CALL_TIMEOUT_MS = 45_000;
const DEFAULT_RESTART_DELAY_MS = 2_500;
const MAX_RESULT_TEXT_CHARS = 12_000;
const MCP_CONFIG_FILE = "mcp.config.json";

function truncateText(value, maxLength = MAX_RESULT_TEXT_CHARS) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeJsonObject(value, fallback = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...fallback };
  }

  return { ...value };
}

function safeErrorMessage(error) {
  if (!error) return "Unknown MCP error";
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return String(error);
}

module.exports = {
  DEFAULT_START_TIMEOUT_MS,
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_RESTART_DELAY_MS,
  MAX_RESULT_TEXT_CHARS,
  MCP_CONFIG_FILE,
  truncateText,
  normalizeJsonObject,
  safeErrorMessage
};
