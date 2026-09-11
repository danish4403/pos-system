const express = require('express');
const router = express.Router();

const BILL_PROMPT = `This is a photo of a shop purchase bill, invoice, or handwritten stock list. Identify every distinct line item on it.
Return ONLY valid JSON with no markdown formatting and no explanation, in exactly this shape:
{"items":[{"name":"string","quantity":number,"price":number,"code":"string or null","category":"string or null"}]}
Rules: "price" is the per-unit cost price as a plain number (no currency symbol). If quantity isn't stated, use 1. If no barcode, SKU, or item code is visible, set "code" to null. "category" is your best-guess general product category for the item (e.g. "Snacks", "Beverages", "Dairy", "Stationery", "Household", "Grocery") — a short single word or two, or null if you can't tell. Skip totals, taxes, and non-item lines.`;

const TAG_PROMPT = `This is a photo of a single product's price tag, label, or barcode. Read the item's name, price, and unique code (barcode number, SKU, or item ID) if visible.
Return ONLY valid JSON with no markdown formatting and no explanation, in exactly this shape:
{"name":"string","price":number,"code":"string or null"}
"price" is a plain number with no currency symbol. If no code is visible, set "code" to null.`;

function parseJsonFromModel(text) {
  let raw = text.trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last >= 0) raw = raw.slice(first, last + 1);
  return JSON.parse(raw);
}

async function extract(base64, prompt) {
  const db = require('../db');
  const apiKey = (db.getSettings().anthropicApiKey || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('No Anthropic API key configured yet. Add one in Settings.');
    err.code = 'NO_API_KEY';
    throw err;
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No reading came back for that image.');
  return parseJsonFromModel(textBlock.text);
}

router.post('/bill', async (req, res) => {
  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });
    const result = await extract(imageBase64, BILL_PROMPT);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(err.code === 'NO_API_KEY' ? 500 : 502).json({ error: err.message });
  }
});

router.post('/tag', async (req, res) => {
  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });
    const result = await extract(imageBase64, TAG_PROMPT);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(err.code === 'NO_API_KEY' ? 500 : 502).json({ error: err.message });
  }
});

module.exports = router;
