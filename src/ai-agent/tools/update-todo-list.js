/**
 * update-todo-list.js
 *
 * Implements update_todo_list for per-session task tracking.
 */

const VALID_TODO_STATUSES = new Set(["pending", "in_progress", "completed"]);
const MAX_TODO_ITEMS = 12;

function normalizeTodoItem(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`Todo item ${index + 1} must be an object`);
  }

  const text = String(item.text || item.task || item.title || "").trim();
  const status = String(item.status || "").trim().toLowerCase();

  if (!text) {
    throw new Error(`Todo item ${index + 1} is missing text`);
  }

  if (!VALID_TODO_STATUSES.has(status)) {
    throw new Error(
      `Todo item ${index + 1} has invalid status "${item.status}". ` +
        "Use pending, in_progress, or completed."
    );
  }

  return { text, status };
}

function normalizeTodoItems(items) {
  if (!Array.isArray(items)) {
    throw new Error("items must be an array");
  }

  if (items.length > MAX_TODO_ITEMS) {
    throw new Error(
      `Todo list exceeds maximum size (${MAX_TODO_ITEMS}). Got ${items.length} item(s).`
    );
  }

  const normalized = items.map((item, index) => normalizeTodoItem(item, index));
  const inProgressCount = normalized.filter(
    (item) => item.status === "in_progress"
  ).length;

  if (inProgressCount > 1) {
    throw new Error("Only one todo item can be in_progress at a time.");
  }

  return normalized;
}

function buildTodoSummary(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "Todo list cleared.";
  }

  const counts = {
    pending: 0,
    in_progress: 0,
    completed: 0
  };

  for (const item of items) {
    if (counts[item.status] !== undefined) {
      counts[item.status] += 1;
    }
  }

  const parts = [];
  if (counts.completed) {
    parts.push(`${counts.completed} completed`);
  }
  if (counts.in_progress) {
    parts.push(`${counts.in_progress} in progress`);
  }
  if (counts.pending) {
    parts.push(`${counts.pending} pending`);
  }

  return parts.length > 0
    ? `Todo list updated: ${parts.join(", ")}.`
    : "Todo list updated.";
}

async function updateTodoList(items, workspaceRoot, executionContext = {}) {
  const normalizedItems = normalizeTodoItems(items);
  const agent = executionContext?.agent;

  if (!agent || typeof agent.updateTodoList !== "function") {
    throw new Error("Todo tracking is unavailable in this execution context.");
  }

  const state = agent.updateTodoList(normalizedItems);
  return {
    success: true,
    todoList: state.todoList,
    counts: state.counts,
    summary: buildTodoSummary(state.todoList)
  };
}

module.exports = {
  updateTodoList,
  normalizeTodoItems,
  buildTodoSummary,
  VALID_TODO_STATUSES,
  MAX_TODO_ITEMS
};

// Made with Bob
