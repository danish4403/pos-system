const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();
const DAY = 86400000;
const money = value => Math.round((Number(value) || 0) * 100) / 100;
const localDate = timestamp => { const d = new Date(timestamp); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function periodFromQuery(query) {
  const now = new Date();
  const today = startOfDay(now);
  const valid = (value) => Number.isFinite(value) && value > 0;
  const customStart = new Date(query.start || '').getTime();
  const customEnd = new Date(query.end || '').getTime();
  if (query.period === 'custom' && valid(customStart) && valid(customEnd) && customEnd >= customStart) {
    const end = customEnd + 1;
    return { start: customStart, end, label: 'Custom range', duration: end - customStart };
  }
  if (query.period === 'today') return { start: today, end: today + DAY, label: 'Today', duration: DAY };
  if (query.period === 'yesterday') return { start: today - DAY, end: today, label: 'Yesterday', duration: DAY };
  if (query.period === 'week') {
    const day = now.getDay() || 7;
    const start = today - (day - 1) * DAY;
    return { start, end: start + 7 * DAY, label: 'This week', duration: 7 * DAY };
  }
  if (query.period === 'lastWeek') {
    const day = now.getDay() || 7;
    const thisWeekStart = today - (day - 1) * DAY;
    const start = thisWeekStart - 7 * DAY;
    return { start, end: thisWeekStart, label: 'Last week', duration: 7 * DAY };
  }
  if (query.period === 'lastMonth') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    const end = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return { start, end, label: 'Last month', duration: end - start };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  return { start, end, label: 'This month', duration: end - start };
}

function previousPeriod(period) {
  return { start: period.start - period.duration, end: period.start, label: 'Previous equivalent period', duration: period.duration };
}
function inPeriod(sale, period) { return Number(sale.timestamp) >= period.start && Number(sale.timestamp) < period.end; }
function returnQty(sale, id) { return (sale.returns || []).reduce((n, r) => n + (r.items || []).filter(x => x.id === id).reduce((a, x) => a + Number(x.qty || 0), 0), 0); }
function saleTotals(sales) {
  return sales.reduce((total, sale) => {
    const returns = (sale.returns || []).reduce((n, r) => n + Number(r.refundAmount || 0), 0);
    const cogs = (sale.items || []).reduce((n, item) => n + Number(item.costPriceAtSale || 0) * Math.max(0, Number(item.qty || 0) - returnQty(sale, item.id)), 0);
    const revenue = Number(sale.total || 0);
    const units = (sale.items || []).reduce((n, item) => n + Math.max(0, Number(item.qty || 0) - returnQty(sale, item.id)), 0);
    return { revenue: total.revenue + revenue, netSales: total.netSales + revenue - returns, returns: total.returns + returns, cogs: total.cogs + cogs, grossProfit: total.grossProfit + revenue - returns - cogs, transactions: total.transactions + (units > 0 ? 1 : 0), unitsSold: total.unitsSold + units };
  }, { revenue: 0, netSales: 0, returns: 0, cogs: 0, grossProfit: 0, transactions: 0, unitsSold: 0 });
}
function expenseTotal(expenses, period) { return expenses.filter(e => { const t = Date.parse(`${e.date}T00:00:00`); return t >= period.start && t < period.end; }).reduce((n, e) => n + Number(e.amount || 0), 0); }
function change(current, previous) {
  const difference = money(current - previous);
  return { current: money(current), previous: money(previous), difference, percentage: previous === 0 ? null : money((difference / Math.abs(previous)) * 100), direction: difference > 0 ? 'up' : difference < 0 ? 'down' : 'flat' };
}

function productAnalytics(inventory, sales, period, previous) {
  const days = Math.max(1, period.duration / DAY);
  return inventory.map(item => {
    const currentRows = sales.filter(s => inPeriod(s, period));
    const previousRows = sales.filter(s => inPeriod(s, previous));
    const metrics = (rows) => rows.reduce((a, sale) => {
      const line = (sale.items || []).find(x => x.id === item.id);
      if (!line) return a;
      const returned = returnQty(sale, item.id);
      const qty = Math.max(0, Number(line.qty || 0) - returned);
      const revenue = Math.max(0, Number(line.lineTotal || line.price * line.qty || 0) - (Number(line.lineTotal || line.price * line.qty || 0) / Math.max(1, Number(line.qty || 1))) * returned);
      const profit = Number(line.lineProfit || 0) - (Number(line.lineProfit || 0) / Math.max(1, Number(line.qty || 1))) * returned;
      return { units: a.units + qty, revenue: a.revenue + revenue, profit: a.profit + profit, frequency: a.frequency + (qty > 0 ? 1 : 0), lastSale: Math.max(a.lastSale || 0, Number(sale.timestamp) || 0) };
    }, { units: 0, revenue: 0, profit: 0, frequency: 0, lastSale: 0 });
    const current = metrics(currentRows), prior = metrics(previousRows);
    const velocity = current.units / days;
    const trend = prior.units === 0 ? (current.units > 0 ? null : 0) : money((current.units - prior.units) / prior.units * 100);
    const status = current.units === 0 ? 'non-moving' : (trend !== null && trend >= 20 ? 'trending-up' : trend !== null && trend <= -20 ? 'declining' : velocity >= 1 ? 'fast-moving' : 'slow-moving');
    const daysSinceLastSale = current.lastSale ? Math.max(0, Math.floor((Date.now() - current.lastSale) / DAY)) : null;
    return { id: item.id, name: item.name, category: item.category || 'Uncategorized', quantity: Number(item.quantity || 0), price: Number(item.price || 0), costPrice: Number(item.costPrice || 0), unitsSold: current.units, revenue: money(current.revenue), profit: money(current.profit), salesFrequency: current.frequency, salesVelocity: money(velocity), daysSinceLastSale, trendPercentage: trend, previousUnitsSold: prior.units, status };
  });
}

function categoryAnalytics(products, inventory, sales, period, previous) {
  const names = [...new Set(inventory.map(i => i.category || 'Uncategorized'))];
  return names.map(category => {
    const rows = products.filter(p => p.category === category);
    const currentSales = sales.filter(s => inPeriod(s, period));
    const previousSales = sales.filter(s => inPeriod(s, previous));
    const sum = (salesRows) => salesRows.reduce((a, sale) => {
      const lines = (sale.items || []).filter(i => inventory.find(x => x.id === i.id)?.category === category);
      if (!lines.length) return a;
      const revenue = lines.reduce((n, line) => n + Number(line.lineTotal || line.price * line.qty || 0), 0);
      const returnedLines = (sale.returns || []).flatMap(r => r.items || []).filter(r => lines.some(line => line.id === r.id));
      const returns = returnedLines.reduce((n, r) => n + Number(r.amount || 0), 0);
      const units = lines.reduce((n, line) => n + Math.max(0, Number(line.qty || 0) - returnedLines.filter(r => r.id === line.id).reduce((x, r) => x + Number(r.qty || 0), 0)), 0);
      const cogs = lines.reduce((n, line) => n + Number(line.costPriceAtSale || 0) * Math.max(0, Number(line.qty || 0) - returnedLines.filter(r => r.id === line.id).reduce((x, r) => x + Number(r.qty || 0), 0)), 0);
      return { revenue: a.revenue + revenue, netSales: a.netSales + revenue - returns, returns: a.returns + returns, cogs: a.cogs + cogs, grossProfit: a.grossProfit + revenue - returns - cogs, transactions: a.transactions + (units > 0 ? 1 : 0), unitsSold: a.unitsSold + units };
    }, { revenue: 0, netSales: 0, returns: 0, cogs: 0, grossProfit: 0, transactions: 0, unitsSold: 0 });
    const current = sum(currentSales), prior = sum(previousSales);
    const inventoryValue = rows.reduce((n, p) => n + p.quantity * (p.costPrice || p.price), 0);
    return { category, revenue: money(current.revenue), netSales: money(current.netSales), unitsSold: current.unitsSold, grossProfit: money(current.grossProfit), transactions: current.transactions, inventoryValue: money(inventoryValue), growthPercentage: prior.netSales === 0 ? null : money((current.netSales - prior.netSales) / Math.abs(prior.netSales) * 100) };
  }).sort((a, b) => b.netSales - a.netSales);
}

function customerAnalytics(customers, sales, period) {
  const rows = new Map();
  sales.forEach(sale => {
    const key = sale.customerPhone || sale.customerName || '';
    if (!key) return;
    const row = rows.get(key) || { key, name: sale.customerName || 'Walk-in', phone: sale.customerPhone || '', totalSpending: 0, purchases: 0, firstPurchase: sale.timestamp, lastPurchase: sale.timestamp };
    row.totalSpending += Number(sale.total || 0) - (sale.returns || []).reduce((n, r) => n + Number(r.refundAmount || 0), 0); row.purchases += 1; row.firstPurchase = Math.min(row.firstPurchase, sale.timestamp); row.lastPurchase = Math.max(row.lastPurchase, sale.timestamp); rows.set(key, row);
  });
  const recent = sales.filter(s => inPeriod(s, period));
  const firstPurchaseKeys = new Set();
  rows.forEach(row => { if (row.firstPurchase >= period.start && row.firstPurchase < period.end) firstPurchaseKeys.add(row.key); });
  const result = [...rows.values()].map(row => ({ ...row, totalSpending: money(row.totalSpending), averageOrderValue: money(row.totalSpending / Math.max(1, row.purchases)), firstPurchaseDate: localDate(row.firstPurchase), lastPurchaseDate: localDate(row.lastPurchase), purchaseFrequency: money(row.purchases / Math.max(1, (Date.now() - row.firstPurchase) / DAY)), status: firstPurchaseKeys.has(row.key) ? 'new' : row.purchases > 1 ? 'repeat' : (Date.now() - row.lastPurchase > 60 * DAY ? 'inactive' : 'one-time') }));
  return { rows: result.sort((a, b) => b.totalSpending - a.totalSpending), recentTransactions: recent.length, top: result.slice(0, 5), repeatCount: result.filter(x => x.status === 'repeat').length, newCount: result.filter(x => x.status === 'new').length, inactiveCount: result.filter(x => x.status === 'inactive').length, customerCount: customers.length || result.length };
}

function buildAnalytics(query = {}) {
  const period = periodFromQuery(query); const previous = previousPeriod(period);
  const inventory = db.getInventory(); const sales = db.getSales(); const expenses = db.getExpenses(); const customers = db.getCustomers();
  const currentSales = sales.filter(s => inPeriod(s, period)); const previousSales = sales.filter(s => inPeriod(s, previous));
  const current = saleTotals(currentSales), prior = saleTotals(previousSales); const currentExpenses = expenseTotal(expenses, period), previousExpenses = expenseTotal(expenses, previous);
  const summary = { revenue: change(current.revenue, prior.revenue), netSales: change(current.netSales, prior.netSales), grossProfit: change(current.grossProfit, prior.grossProfit), expenses: change(currentExpenses, previousExpenses), netProfit: change(current.grossProfit - currentExpenses, prior.grossProfit - previousExpenses), transactions: change(current.transactions, prior.transactions), unitsSold: change(current.unitsSold, prior.unitsSold), cogs: money(current.cogs), returns: money(current.returns) };
  const products = productAnalytics(inventory, sales, period, previous); const categories = categoryAnalytics(products, inventory, sales, period, previous); const customer = customerAnalytics(customers, sales, period);
  const nonMoving = products.filter(p => p.status === 'non-moving' && p.quantity > 0); const low = inventory.filter(i => Number(i.quantity || 0) > 0 && Number(i.quantity || 0) <= Number(i.reorderLevel ?? i.lowStockThreshold ?? 3)); const critical = inventory.filter(i => Number(i.quantity || 0) <= 0);
  const inventoryHealth = { totalProducts: inventory.length, healthyStock: inventory.filter(i => Number(i.quantity || 0) > Number(i.reorderLevel ?? i.lowStockThreshold ?? 3)).length, lowStockProducts: low.length, criticalStockProducts: critical.length, nonMovingProducts: nonMoving.length, fastMovingProducts: products.filter(p => p.status === 'fast-moving').length, totalInventoryValue: money(inventory.reduce((n, i) => n + Number(i.quantity || 0) * Number(i.price || 0), 0)), capitalLockedInInventory: money(nonMoving.reduce((n, p) => n + p.quantity * (p.costPrice || p.price), 0)), capitalBasis: nonMoving.some(p => p.costPrice > 0) ? 'cost and retail fallback' : 'retail value' };
  const insights = [];
  const add = (type, title, message, metric, action, destination) => insights.push({ type, title, message, metric, action, destination, priority: type === 'Attention' ? 4 : type === 'Warning' ? 3 : type === 'Positive' ? 2 : 1 });
  if (inventoryHealth.criticalStockProducts) add('Attention', 'Critical stock', `${inventoryHealth.criticalStockProducts} product${inventoryHealth.criticalStockProducts === 1 ? '' : 's'} have no units left.`, inventoryHealth.criticalStockProducts, 'Restock', 'inventory');
  if (inventoryHealth.lowStockProducts) add('Warning', 'Low stock watch', `${inventoryHealth.lowStockProducts} product${inventoryHealth.lowStockProducts === 1 ? '' : 's'} are at or below their reorder level.`, inventoryHealth.lowStockProducts, 'Review inventory', 'inventory');
  if (summary.expenses.percentage !== null && summary.expenses.percentage >= 20) add('Warning', 'Rising expenses', `Operating expenses increased by ${summary.expenses.percentage.toFixed(1)}% versus the previous period.`, summary.expenses.percentage, 'View expenses', 'expenses');
  if (summary.netSales.percentage !== null && summary.netSales.percentage >= 10) add('Positive', 'Sales momentum', `Net sales increased by ${summary.netSales.percentage.toFixed(1)}% versus the previous period.`, summary.netSales.percentage, 'View sales', 'history');
  if (inventoryHealth.capitalLockedInInventory > 0) add('Attention', 'Capital locked in stock', `${money(inventoryHealth.capitalLockedInInventory).toFixed(2)} of inventory value has not moved in the selected period.`, inventoryHealth.capitalLockedInInventory, 'Review slow movers', 'analytics');
  if (products.filter(p => p.status === 'slow-moving').length) add('Information', 'Slow movers', `${products.filter(p => p.status === 'slow-moving').length} products have sales below the selected-period velocity baseline.`, products.filter(p => p.status === 'slow-moving').length, 'Review products', 'analytics');
  insights.sort((a, b) => b.priority - a.priority);
  return { period, previous, summary, products, categories, customers: customer, inventoryHealth, insights: insights.slice(0, 6) };
}

router.get('/', requireAdmin, (req, res) => {
  try {
    res.json(buildAnalytics(req.query));
  } catch (err) {
    console.error('[analytics]', err);
    res.status(500).json({ error: 'Unable to calculate analytics right now.' });
  }
});

module.exports = router;
// Exporting the same controlled calculation used by GET /api/analytics lets
// backend services reuse verified BI data without making the router or data
// store available to Ollama.
module.exports.buildAnalytics = buildAnalytics;
module.exports.periodFromQuery = periodFromQuery;
