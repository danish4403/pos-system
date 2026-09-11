// Controlled SmartRetail BI Copilot.
//
// This service is deliberately the only bridge between user questions,
// SmartRetail's analytics, and Ollama. Ollama receives a small, verified
// result produced by backend code; it never receives database access or a
// function/tool interface.

const db = require('../db');
const analytics = require('../routes/analytics');
const ollama = require('./ollama');

const INTENTS = Object.freeze([
  'SALES_SUMMARY',
  'SALES_COMPARISON',
  'TOP_PRODUCTS',
  'SLOW_MOVING_PRODUCTS',
  'LOW_STOCK',
  'RESTOCK_RECOMMENDATIONS',
  'PROFIT_SUMMARY',
  'LOW_MARGIN_PRODUCTS',
  'EXPENSE_SUMMARY',
  'BUSINESS_FOCUS',
]);

const PERIODS = Object.freeze(['TODAY', 'YESTERDAY', 'THIS_WEEK', 'LAST_WEEK', 'THIS_MONTH', 'LAST_MONTH']);
const PERIOD_QUERY = { TODAY: 'today', YESTERDAY: 'yesterday', THIS_WEEK: 'week', LAST_WEEK: 'lastWeek', THIS_MONTH: 'month', LAST_MONTH: 'lastMonth' };
const money = value => Math.round((Number(value) || 0) * 100) / 100;
const clampText = (value, max) => String(value || '').trim().slice(0, max);

class BiCopilotError extends Error {
  constructor(message, code, statusCode = 502) {
    super(message);
    this.name = 'BiCopilotError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function parseJsonObject(text) {
  let raw = String(text || '').trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) raw = raw.slice(first, last + 1);
  return JSON.parse(raw);
}

function normalizeIntent(value) {
  const intent = String(value || '').trim().toUpperCase();
  return INTENTS.includes(intent) ? intent : 'UNKNOWN';
}

function normalizePeriod(value) {
  const period = String(value || '').trim().toUpperCase();
  return PERIODS.includes(period) ? period : 'THIS_MONTH';
}

async function detectIntent(question) {
  const prompt = `You classify SmartRetail POS questions. Return ONLY valid JSON, with no markdown, in exactly this shape: {"intent":"SALES_SUMMARY","period":"THIS_MONTH","confidence":0.95}. Confidence must be a number from 0 to 1 reflecting how clearly the question matches.\nSupported intents: ${INTENTS.join(', ')}.\nSupported periods: ${PERIODS.join(', ')}.\nUse UNKNOWN when the question cannot be mapped safely. Do not invent another intent.\nQuestion: ${question}`;
  let result;
  try {
    result = parseJsonObject((await ollama.generateText(prompt, { temperature: 0 })).text);
  } catch (err) {
    if (err instanceof SyntaxError) return { intent: 'UNKNOWN', period: 'THIS_MONTH', confidence: 0 };
    throw new BiCopilotError(`Intent detection failed: ${err.message}`, err.code || 'INTENT_DETECTION_FAILED', err.statusCode || 502);
  }
  const intent = normalizeIntent(result.intent);
  const confidence = Number(result.confidence);
  return {
    intent,
    period: normalizePeriod(result.period),
    // Some local models copy the JSON example's zero confidence even after
    // selecting a valid intent. Keep the explicit intent while assigning a
    // conservative usable confidence; UNKNOWN remains confidence 0.
    confidence: intent === 'UNKNOWN' ? 0 : (Number.isFinite(confidence) && confidence > 0 ? Math.max(0, Math.min(1, confidence)) : 0.5),
  };
}

function metricValue(metric) {
  if (!metric) return { current: 0, previous: 0, difference: 0, percentage: null, direction: 'flat' };
  return { current: money(metric.current), previous: money(metric.previous), difference: money(metric.difference), percentage: metric.percentage === null ? null : money(metric.percentage), direction: metric.direction };
}

function periodData(result) {
  return {
    label: result.period.label,
    start: result.period.start,
    end: result.period.end,
    previousLabel: result.previous.label,
    baselineAvailable: result.summary.netSales.percentage !== null,
    currencySymbol: db.getSettings().currencySymbol || '₹',
  };
}

function lowStockRows() {
  return db.getInventory()
    .map(item => {
      const quantity = Number(item.quantity || 0);
      const reorderLevel = Number(item.reorderLevel ?? item.lowStockThreshold ?? 3);
      return { id: item.id, name: item.name, category: item.category || 'Uncategorized', quantity, reorderLevel, status: quantity <= 0 ? 'critical' : quantity <= reorderLevel ? 'low' : 'healthy' };
    })
    .filter(item => item.status !== 'healthy')
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name));
}

function expenseBreakdown(period) {
  const rows = db.getExpenses().filter(expense => {
    const timestamp = Date.parse(`${expense.date}T00:00:00`);
    return timestamp >= period.start && timestamp < period.end;
  });
  const byCategory = {};
  let fixed = 0;
  let variable = 0;
  rows.forEach(expense => {
    const amount = Number(expense.amount || 0);
    const category = String(expense.category || 'Other').trim() || 'Other';
    byCategory[category] = money((byCategory[category] || 0) + amount);
    if (expense.type === 'fixed') fixed += amount; else variable += amount;
  });
  return { fixed: money(fixed), variable: money(variable), byCategory: Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount })) };
}

function productsWithMargins(products) {
  return products
    .filter(product => Number(product.unitsSold || 0) > 0 && Number(product.revenue || 0) > 0)
    .map(product => ({
      name: product.name,
      category: product.category,
      unitsSold: product.unitsSold,
      revenue: money(product.revenue),
      grossProfit: money(product.profit),
      marginPercentage: money((Number(product.profit || 0) / Number(product.revenue || 1)) * 100),
      status: product.status,
    }))
    .sort((a, b) => a.marginPercentage - b.marginPercentage);
}

function buildCapabilityData(intent, period) {
  const result = analytics.buildAnalytics({ period: PERIOD_QUERY[period] || 'month' });
  const summary = result.summary;
  const base = { period: periodData(result) };

  if (intent === 'SALES_SUMMARY') {
    return { ...base, sales: { revenue: metricValue(summary.revenue), netSales: metricValue(summary.netSales), returns: summary.returns, transactions: metricValue(summary.transactions), unitsSold: metricValue(summary.unitsSold) } };
  }
  if (intent === 'SALES_COMPARISON') {
    return { ...base, comparison: { netSales: metricValue(summary.netSales), revenue: metricValue(summary.revenue), transactions: metricValue(summary.transactions), unitsSold: metricValue(summary.unitsSold) } };
  }
  if (intent === 'TOP_PRODUCTS') {
    const products = [...result.products].sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue).slice(0, 5);
    return { ...base, products: products.map(p => ({ name: p.name, category: p.category, unitsSold: p.unitsSold, revenue: money(p.revenue), grossProfit: money(p.profit), status: p.status, trendPercentage: p.trendPercentage })) };
  }
  if (intent === 'SLOW_MOVING_PRODUCTS') {
    const products = result.products.filter(p => ['slow-moving', 'non-moving', 'declining'].includes(p.status)).sort((a, b) => (b.quantity - a.quantity) || (a.unitsSold - b.unitsSold)).slice(0, 10);
    return { ...base, products: products.map(p => ({ name: p.name, category: p.category, quantityRemaining: p.quantity, unitsSold: p.unitsSold, daysSinceLastSale: p.daysSinceLastSale, status: p.status, trendPercentage: p.trendPercentage })) };
  }
  if (intent === 'LOW_STOCK') {
    return { ...base, inventoryHealth: result.inventoryHealth, products: lowStockRows() };
  }
  if (intent === 'RESTOCK_RECOMMENDATIONS') {
    const products = lowStockRows().map(p => ({ ...p, recommendedUnits: Math.max(0, p.reorderLevel * 2 - p.quantity), action: p.status === 'critical' ? 'Restock immediately' : 'Restock before the next busy period' }));
    return { ...base, products };
  }
  if (intent === 'PROFIT_SUMMARY') {
    return { ...base, profitability: { revenue: metricValue(summary.revenue), netSales: metricValue(summary.netSales), returns: summary.returns, costOfGoodsSold: summary.cogs, grossProfit: metricValue(summary.grossProfit), operatingExpenses: metricValue(summary.expenses), netProfit: metricValue(summary.netProfit), marginPercentage: summary.netSales.current ? money((summary.netProfit.current / summary.netSales.current) * 100) : null } };
  }
  if (intent === 'LOW_MARGIN_PRODUCTS') {
    const products = productsWithMargins(result.products).slice(0, 10);
    return { ...base, products, dataAvailable: products.length > 0 };
  }
  if (intent === 'EXPENSE_SUMMARY') {
    return { ...base, expenses: { total: metricValue(summary.expenses), fixed: expenseBreakdown(result.period).fixed, variable: expenseBreakdown(result.period).variable, byCategory: expenseBreakdown(result.period).byCategory } };
  }
  if (intent === 'BUSINESS_FOCUS') {
    const lowMargin = productsWithMargins(result.products).slice(0, 5);
    return { ...base, alerts: result.insights, inventoryHealth: result.inventoryHealth, lowMarginProducts: lowMargin, sales: { netSales: metricValue(summary.netSales), expenses: metricValue(summary.expenses), netProfit: metricValue(summary.netProfit) } };
  }
  return null;
}

function answerPrompt(question, intent, data) {
  return `You are SmartRetail AI Copilot, a concise retail business analyst. Answer the user's question using ONLY the verified backend data below. Do not invent numbers, products, trends, causes, or actions unsupported by the data. Treat fields named revenue, netSales, expenses, grossProfit, netProfit, amount, and marginPercentage as provided values; do not reinterpret currency amounts as units. Only unitsSold/current and quantity fields are units. For inventory, use each products[].quantity exactly; do not confuse a count such as criticalStockProducts=1 with a product quantity of 1. Use the currencySymbol supplied in the period object. If baselineAvailable is false or a percentage is null, say that no previous-period baseline is available instead of claiming growth. If an array is empty, say no matching records were found. Use clear business language, mention the period, and finish with a practical next step when the data supports one.\n\nVERIFIED DATA (JSON):\n${JSON.stringify(data)}\n\nCAPABILITY: ${intent}\nUSER QUESTION: ${question}`;
}

async function answerQuestion(question) {
  const cleanQuestion = clampText(question, 500);
  if (!cleanQuestion) throw new BiCopilotError('Question is required.', 'INVALID_QUESTION', 400);

  const detected = await detectIntent(cleanQuestion);
  if (detected.intent === 'UNKNOWN') {
    return { success: false, question: cleanQuestion, intent: 'UNKNOWN', period: detected.period, confidence: detected.confidence, data: null, answer: 'I can help with sales, product performance, stock, profitability, expenses, and business priorities. Please ask one of those questions.' };
  }

  let data;
  try {
    data = buildCapabilityData(detected.intent, detected.period);
  } catch (err) {
    throw new BiCopilotError(`Business analytics could not be calculated: ${err.message}`, 'ANALYTICS_ERROR', 500);
  }

  let answer;
  try {
    answer = (await ollama.generateText(answerPrompt(cleanQuestion, detected.intent, data), { temperature: 0.2 })).text;
  } catch (err) {
    throw new BiCopilotError(`Copilot explanation failed: ${err.message}`, err.code || 'ANSWER_GENERATION_FAILED', err.statusCode || 502);
  }
  return { success: true, question: cleanQuestion, intent: detected.intent, period: detected.period, confidence: detected.confidence, data, answer };
}

module.exports = { INTENTS, PERIODS, detectIntent, buildCapabilityData, answerQuestion, BiCopilotError };
