const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const router = express.Router();
const money = n => Math.round((Number(n) || 0) * 100) / 100;
const localDate = timestamp => { const d = new Date(timestamp); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

// Sales currently record one payment method per bill. Keep this helper
// tolerant of future/imported mixed-payment records so the summary remains
// accurate if a payment breakdown is present on a sale.
function paymentAmount(sale, method) {
  const breakdown = sale.paymentBreakdown || sale.paymentAmounts || sale.payments;
  if (Array.isArray(breakdown) && breakdown.length) {
    return breakdown.reduce((sum, p) => sum + (String(p.method || p.paymentMethod || p.type || '').toLowerCase() === method ? Number(p.amount || 0) : 0), 0);
  }
  if (breakdown && typeof breakdown === 'object' && Object.keys(breakdown).length) {
    const key = Object.keys(breakdown).find(k => k.toLowerCase() === method);
    if (key) return Number(breakdown[key]) || 0;
  }
  // New and settled due sales carry a payment ledger. Older records without
  // a method are safely treated as cash, matching the legacy checkout UI.
  if (Array.isArray(sale.paymentHistory) && sale.paymentHistory.length) {
    return sale.paymentHistory.reduce((sum, payment) => {
      const recordedMethod = String(payment.method || payment.paymentMethod || (sale.paymentMethod === 'due' ? 'cash' : sale.paymentMethod) || '').toLowerCase();
      return sum + (recordedMethod === method ? Number(payment.amount || 0) : 0);
    }, 0);
  }
  return String(sale.paymentMethod || '').toLowerCase() === method ? Number(sale.amountPaid || 0) : 0;
}

function summary(date) {
  const sales = db.getSales().filter(s => localDate(s.timestamp) === date);
  const expenses = db.getExpenses().filter(e => e.date === date);
  const grossSales = money(sales.reduce((n,s) => n + Number(s.total || 0), 0));
  const cashSales = money(sales.reduce((n, s) => n + paymentAmount(s, 'cash'), 0));
  const cardSales = money(sales.reduce((n, s) => n + paymentAmount(s, 'card'), 0));
  const upiSales = money(sales.reduce((n, s) => n + paymentAmount(s, 'upi'), 0));
  const cashRefunds = money(sales.reduce((n,s) => n + (s.returns || []).reduce((r,x) => r + Number(x.cashRefund || 0), 0), 0));
  const totalRefunds = money(sales.reduce((n,s) => n + (s.returns || []).reduce((r,x) => r + Number(x.refundAmount || 0), 0), 0));
  const cashExpenses = money(expenses.filter(e => (e.paymentMethod || 'cash') === 'cash').reduce((n,e) => n + Number(e.amount || 0), 0));
  const totalExpenses = money(expenses.reduce((n,e) => n + Number(e.amount || 0), 0));
  const saved = db.getDailyClosings().find(c => c.date === date) || null;
  const openingCash = money(saved?.openingCash || 0);
  const expectedCash = money(openingCash + cashSales - cashRefunds - cashExpenses);
  return { date, grossSales, netSales: money(grossSales-totalRefunds), totalRefunds, cashSales, cardSales, upiSales, cashRefunds, cashExpenses, totalExpenses, saleCount:sales.length, expenseCount:expenses.length, openingCash, expectedCash, closing:saved };
}

router.get('/daily-closing', requireAdmin, (req,res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : localDate(Date.now());
  res.json(summary(date));
});
router.put('/daily-closing', requireAdmin, (req,res) => {
  const { date, openingCash, countedCash, note } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error:'Choose a valid closing date' });
  const rows = db.getDailyClosings(); const previous = rows.find(c => c.date === date);
  const record = { date, openingCash:money(openingCash), countedCash:money(countedCash), note:String(note || '').trim().slice(0,300), closedAt:Date.now(), closedBy:'admin' };
  if (previous) Object.assign(previous, record); else rows.unshift(record);
  db.setDailyClosings(rows);
  res.json(summary(date));
});
module.exports = router;
