// Small, backend-only client for the locally running Ollama service.
// Keeping this here means the browser never talks to Ollama directly and
// future AI features can be added without giving the model database access.

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';
const DEFAULT_TIMEOUT_MS = 30000;

function config() {
  const timeout = Number(process.env.OLLAMA_TIMEOUT_MS);
  return {
    baseUrl: String(process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: String(process.env.OLLAMA_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 120000) : DEFAULT_TIMEOUT_MS,
  };
}

class OllamaError extends Error {
  constructor(message, code, statusCode = 503) {
    super(message);
    this.name = 'OllamaError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function generateText(prompt, options = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw new OllamaError('An Ollama prompt is required.', 'INVALID_PROMPT', 400);

  const settings = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);

  try {
    let response;
    try {
      response = await fetch(`${settings.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.model,
          prompt: text,
          stream: false,
          ...(options.temperature === undefined ? {} : { options: { temperature: options.temperature } }),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new OllamaError(`Ollama did not respond within ${settings.timeoutMs}ms.`, 'OLLAMA_TIMEOUT', 504);
      }
      throw new OllamaError('Ollama is not running or cannot be reached at the configured local address.', 'OLLAMA_UNAVAILABLE', 503);
    }

    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) { /* handled below */ }

    if (!response.ok) {
      const detail = data && data.error ? data.error : raw.slice(0, 300);
      throw new OllamaError(`Ollama returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`, 'OLLAMA_HTTP_ERROR', 502);
    }
    if (!data || typeof data.response !== 'string') {
      throw new OllamaError('Ollama returned an invalid response.', 'OLLAMA_INVALID_RESPONSE', 502);
    }

    return { text: data.response.trim(), model: data.model || settings.model };
  } finally {
    clearTimeout(timer);
  }
}

const TEST_PROMPT = 'You are SmartRetail AI. Reply exactly with: SmartRetail AI connection successful.';

async function testConnection() {
  const result = await generateText(TEST_PROMPT, { temperature: 0 });
  return {
    ...result,
    expected: 'SmartRetail AI connection successful.',
    exactMatch: result.text === 'SmartRetail AI connection successful.',
  };
}

module.exports = { generateText, testConnection, TEST_PROMPT, OllamaError, config };
