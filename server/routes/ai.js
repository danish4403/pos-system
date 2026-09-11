const express = require('express');
const { requireAdmin } = require('../auth');
const ollama = require('../services/ollama');
const copilot = require('../services/biCopilot');

const router = express.Router();

// Fixed-prompt smoke test only. Arbitrary prompts and model access are not
// exposed through this route until a scoped AI feature is designed.
router.get('/ollama/test', requireAdmin, async (req, res) => {
  try {
    const result = await ollama.testConnection();
    res.json({
      ok: true,
      connection: 'successful',
      model: result.model,
      response: result.text,
      expected: result.expected,
      exactMatch: result.exactMatch,
    });
  } catch (err) {
    console.error('[ollama]', err.message);
    res.status(err.statusCode || 503).json({
      ok: false,
      connection: 'failed',
      code: err.code || 'OLLAMA_ERROR',
      error: err.message,
    });
  }
});

// Controlled BI Copilot endpoint. The service selects only predefined
// capabilities and sends Ollama verified analytics data—not database access.
router.post('/copilot', requireAdmin, async (req, res) => {
  const question = req.body && req.body.question;
  if (!String(question || '').trim()) return res.status(400).json({ success: false, error: 'A question is required.' });
  try {
    const result = await copilot.answerQuestion(question);
    res.json(result);
  } catch (err) {
    console.error('[bi-copilot]', err.message);
    res.status(err.statusCode || 502).json({
      success: false,
      error: err.message || 'Unable to answer this question right now.',
      code: err.code || 'COPILOT_ERROR',
    });
  }
});

module.exports = router;
