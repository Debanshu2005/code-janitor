const DEFAULT_MAX_STRING_PARAM_CHARS = 1_000_000;
const DEFAULT_MAX_OUTPUT_CHARS = 2_000_000;

function estimateStringSize(value, seen = new Set()) {
  if (typeof value === "string") {
    return value.length;
  }
  if (!value || typeof value !== "object") {
    return 0;
  }
  if (seen.has(value)) {
    return 0;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + estimateStringSize(item, seen), 0);
  }

  return Object.values(value).reduce(
    (sum, item) => sum + estimateStringSize(item, seen),
    0
  );
}

function guardrailPass(details = {}) {
  return { allowed: true, ...details };
}

function guardrailBlock(reason, details = {}) {
  return { allowed: false, reason, ...details };
}

class ToolGuardrailManager {
  constructor(options = {}) {
    this.maxStringParamChars =
      options.maxStringParamChars || DEFAULT_MAX_STRING_PARAM_CHARS;
    this.maxOutputChars = options.maxOutputChars || DEFAULT_MAX_OUTPUT_CHARS;
    this.inputGuardrails = [];
    this.outputGuardrails = [];
    this._registerDefaultGuardrails();
  }

  registerInputGuardrail(name, fn) {
    if (typeof fn !== "function") {
      throw new Error("Input guardrail must be a function.");
    }
    this.inputGuardrails.push({ name, fn });
  }

  registerOutputGuardrail(name, fn) {
    if (typeof fn !== "function") {
      throw new Error("Output guardrail must be a function.");
    }
    this.outputGuardrails.push({ name, fn });
  }

  async runInputGuardrails(context) {
    return this._runGuardrails(this.inputGuardrails, context);
  }

  async runOutputGuardrails(context) {
    return this._runGuardrails(this.outputGuardrails, context);
  }

  async _runGuardrails(guardrails, context) {
    const results = [];
    for (const guardrail of guardrails) {
      const startedAt = Date.now();
      const result = await guardrail.fn(context);
      const normalized = result || guardrailPass();
      results.push({
        name: guardrail.name,
        allowed: normalized.allowed !== false,
        durationMs: Date.now() - startedAt,
        reason: normalized.reason || ""
      });

      if (normalized.allowed === false) {
        return {
          allowed: false,
          reason: normalized.reason || `Blocked by guardrail ${guardrail.name}`,
          results
        };
      }
    }

    return { allowed: true, results };
  }

  _registerDefaultGuardrails() {
    this.registerInputGuardrail("params_are_object", ({ params }) => {
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        return guardrailBlock("Tool parameters must be a JSON object.");
      }
      return guardrailPass();
    });

    this.registerInputGuardrail("bounded_string_params", ({ params, toolName }) => {
      const size = estimateStringSize(params);
      if (size > this.maxStringParamChars) {
        return guardrailBlock(
          `Tool ${toolName} parameters exceed the guardrail size limit.`
        );
      }
      return guardrailPass({ size });
    });

    this.registerOutputGuardrail("bounded_output", ({ result, toolName }) => {
      const size = estimateStringSize(result);
      if (size > this.maxOutputChars) {
        return guardrailBlock(
          `Tool ${toolName} output exceeded the guardrail size limit.`
        );
      }
      return guardrailPass({ size });
    });
  }
}

const toolGuardrails = new ToolGuardrailManager();

module.exports = {
  ToolGuardrailManager,
  toolGuardrails,
  guardrailPass,
  guardrailBlock,
  estimateStringSize
};
