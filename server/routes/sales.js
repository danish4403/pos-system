const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const { requireAdmin, requireStaff } = require('../auth');
const { sanitizePhone } = require('../util');

const genId = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const PAYMENT_METHODS = ['cash', 'upi', 'card', 'due'];
const SETTLEMENT_METHODS = ['cash', 'upi', 'card'];

function localDate(timestamp) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfLocalDay(timestamp) {
  const d = new Date(timestamp);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function isAdminSession(req) {
  return !!(req.session && req.session.role === 'admin');
}
// Employees see everything about a sale except what reveals margin: cost
// price and profit, per line.
function stripProfit(sale, admin) {
  const netTotal = round2(Number(sale.total || 0) - (sale.returns || []).reduce((sum, r) => sum + Number(r.refundAmount || 0), 0));
  const enriched = { ...sale, refundTotal: round2(Number(sale.total || 0) - netTotal), netTotal };
  if (admin) return enriched;
  return {
    ...enriched,
    items: sale.items.map(({ costPriceAtSale, lineProfit, ...rest }) => rest),
  };
}

// ---- shared calculation, used by both create (POST) and edit (PUT) ----
// `inv` must already reflect the stock available to sell against (for an
// edit, the caller restores the original sale's quantities first).
function computeLines(inv, cartItems) {
  const lines = [];
  for (const line of cartItems) {
    const invItem = inv.find((i) => i.id === line.invId);
    if (!invItem) { const e = new Error(`An item in this sale no longer exists`); e.status = 400; throw e; }
    const qty = Math.max(1, Number(line.qty) || 1);
    if (qty > Number(invItem.quantity || 0)) {
      const e = new Error(`Not enough stock for "${invItem.name}" — ${invItem.quantity} available`);
      e.status = 400;
      throw e;
    }
    const lineSubtotal = round2(invItem.price * qty);
    lines.push({
      id: invItem.id,
      name: invItem.name,
      price: invItem.price,
      costPriceAtSale: Number(invItem.costPrice) || 0,
      qty,
      lineSubtotal,
    });
  }
  return lines;
}

function applyDiscount(lines, discountMode, discountValue) {
  const subtotal = round2(lines.reduce((s, l) => s + l.lineSubtotal, 0));
  const value = Math.max(0, Number(discountValue) || 0); // never a negative discount (that would raise the price)
  let discountAmount = 0;
  let total = subtotal;
  if (discountMode === 'percent') {
    discountAmount = round2(subtotal * (Math.min(value, 100) / 100));
    total = round2(subtotal - discountAmount);
  } else if (discountMode === 'amount') {
    discountAmount = round2(Math.min(value, subtotal));
    total = round2(subtotal - discountAmount);
  } else if (discountMode === 'finalPrice') {
    total = round2(Math.max(0, Math.min(value, subtotal)));
    discountAmount = round2(subtotal - total);
  }
  // Never let rounding or an edge case push the total negative.
  total = Math.max(0, total);
  const discountPercent = subtotal > 0 ? round2((discountAmount / subtotal) * 100) : 0;

  lines.forEach((l) => {
    const share = subtotal > 0 ? l.lineSubtotal / subtotal : 0;
    l.lineDiscount = round2(discountAmount * share);
    l.lineTotal = round2(l.lineSubtotal - l.lineDiscount);
    l.lineProfit = round2(l.lineTotal - l.costPriceAtSale * l.qty);
  });

  return { subtotal, discountAmount, discountPercent, total };
}

// The shop should never knowingly sell below what it paid. If the
// discounted total drops below the total cost of goods in the cart, block
// the sale with a clear minimum.
function totalCostOf(lines) {
  return round2(lines.reduce((s, l) => s + l.costPriceAtSale * l.qty, 0));
}

function restoreStock(inv, lines) {
  lines.forEach((l) => {
    const invItem = inv.find((i) => i.id === l.id);
    if (invItem) invItem.quantity = Number(invItem.quantity || 0) + l.qty;
  });
}
function deductStock(inv, lines) {
  lines.forEach((l) => {
    const invItem = inv.find((i) => i.id === l.id);
    if (invItem) invItem.quantity = Math.max(0, Number(invItem.quantity || 0) - l.qty);
  });
}

function returnedQtyByItem(sale) {
  const map = {};
  (sale.returns || []).forEach((r) => r.items.forEach((i) => { map[i.id] = (map[i.id] || 0) + i.qty; }));
  return map;
}

// Completing a sale is the core cashier action — never gated behind login.
// Discount and payment method are decided here, at checkout. Discounts
// above the configured employee limit need a manager password.
router.post('/', requireStaff, (req, res) => {
  const cart = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!cart.length) return res.status(400).json({ error: 'Cart is empty' });

  const discountMode = ['percent', 'amount', 'finalPrice'].includes(req.body?.discountMode) ? req.body.discountMode : 'none';
  const discountValue = Math.max(0, Number(req.body?.discountValue) || 0);
  const paymentMethod = PAYMENT_METHODS.includes(req.body?.paymentMethod) ? req.body.paymentMethod : 'cash';
  const customerName = req.body?.customerName ? String(req.body.customerName).trim().slice(0, 80) : '';
  const customerPhone = sanitizePhone(req.body?.customerPhone);
  const customerAddress = req.body?.customerAddress ? String(req.body.customerAddress).trim().slice(0, 200) : '';

  const inv = db.getInventory();
  let lines;
  try {
    lines = computeLines(inv, cart.map((c) => ({ invId: c.invId, qty: c.qty })));
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }
  const { subtotal, discountAmount, discountPercent, total } = applyDiscount(lines, discountMode, discountValue);

  const minTotal = totalCostOf(lines);
  if (total < minTotal) {
    return res.status(400).json({ error: `That discount would sell below cost price. Lowest allowed total: ₹${minTotal.toFixed(2)}.` });
  }

  // Discount-limit gate: anything above the configured employee limit needs
  // a manager password entered right there at checkout.
  const settings = db.getSettings();
  const limit = Number(settings.maxEmployeeDiscountPercent) || 0;
  let approval = null;
  if (discountAmount > 0 && discountPercent > limit + 0.05) {
    const pw = req.body?.managerPassword || '';
    if (!auth.verifyAdminPassword(pw)) {
      return res.status(403).json({
        error: `This discount (${discountPercent.toFixed(1)}%) is above the ${limit}% employee limit — manager password required.`,
        code: 'MANAGER_APPROVAL_REQUIRED',
        maxAllowed: limit,
        requestedPercent: discountPercent,
      });
    }
    approval = { discountPercent, subtotal, discountAmount };
  }

  let amountPaid = total;
  if (paymentMethod === 'due') {
    amountPaid = round2(Math.max(0, Math.min(Number(req.body?.amountPaid) || 0, total)));
  }
  const amountDue = round2(Math.max(0, total - amountPaid));

  deductStock(inv, lines);
  db.setInventory(inv);

  const sale = {
    id: genId('SALE'),
    timestamp: Date.now(),
    items: lines,
    subtotal,
    discountMode,
    discountAmount,
    discountPercent,
    total,
    paymentMethod,
    amountPaid,
    amountDue,
    customerName,
    customerPhone,
    customerAddress,
    paymentHistory: [{ timestamp: Date.now(), amount: amountPaid, method: paymentMethod === 'due' ? 'cash' : paymentMethod, note: paymentMethod === 'due' ? 'At sale' : 'Paid in full' }],
    returns: [],
    edited: false,
    editHistory: [],
  };
  db.addSale(sale);

  if (approval) {
    db.addDiscountApproval({
      id: genId('APR'),
      timestamp: Date.now(),
      saleId: sale.id,
      discountPercent: approval.discountPercent,
      subtotal: approval.subtotal,
      discountAmount: approval.discountAmount,
    });
  }

  res.json(stripProfit(sale, isAdminSession(req)));
});

// Sales history reveals revenue — kept behind staff login. Profit/cost
// figures within it are stripped for non-admin staff.
router.get('/', requireStaff, (req, res) => {
  const admin = isAdminSession(req);
  const today = new Date().toDateString();
  const sales = admin ? db.getSales() : db.getSales().filter((s) => new Date(s.timestamp).toDateString() === today);
  res.json(sales.map((s) => stripProfit(s, admin)));
});

// Audit log of extra-discount approvals — admin only, this is oversight data.
router.get('/discount-approvals', requireAdmin, (req, res) => {
  res.json(db.getDiscountApprovals());
});

// Edit a completed bill. Any staff member — the employee discount-limit
// check does not re-apply here since a logged-in session is already
// itself a level of accountability (and the edit is attributed via role).
router.put('/:id', requireAdmin, (req, res) => {
  const sales = db.getSales();
  const sale = sales.find((s) => s.id === req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });

  const cart = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!cart.length) return res.status(400).json({ error: 'A bill needs at least one item' });

  // Can't edit a line's quantity below what's already been returned against it.
  const alreadyReturned = returnedQtyByItem(sale);
  for (const [itemId, returnedQty] of Object.entries(alreadyReturned)) {
    const stillInCart = cart.find((c) => c.invId === itemId);
    const newQty = stillInCart ? Number(stillInCart.qty) || 0 : 0;
    if (newQty < returnedQty) {
      const name = (sale.items.find((l) => l.id === itemId) || {}).name || itemId;
      return res.status(400).json({ error: `Can't reduce "${name}" below ${returnedQty} — that many have already been returned on this bill.` });
    }
  }

  const discountMode = ['percent', 'amount', 'finalPrice'].includes(req.body?.discountMode) ? req.body.discountMode : 'none';
  const discountValue = Math.max(0, Number(req.body?.discountValue) || 0);
  const paymentMethod = PAYMENT_METHODS.includes(req.body?.paymentMethod) ? req.body.paymentMethod : 'cash';
  const customerName = req.body?.customerName ? String(req.body.customerName).trim().slice(0, 80) : '';
  const customerPhone = sanitizePhone(req.body?.customerPhone);
  const customerAddress = req.body?.customerAddress ? String(req.body.customerAddress).trim().slice(0, 200) : '';

  const inv = JSON.parse(JSON.stringify(db.getInventory())); // work on a clone — nothing touches live stock until the edit is fully validated
  restoreStock(inv, sale.items); // give back the original line quantities first

  let lines;
  try {
    lines = computeLines(inv, cart.map((c) => ({ invId: c.invId, qty: c.qty })));
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }
  const { subtotal, discountAmount, discountPercent, total } = applyDiscount(lines, discountMode, discountValue);

  const minTotal = totalCostOf(lines);
  if (total < minTotal) {
    return res.status(400).json({ error: `That discount would sell below cost price. Lowest allowed total: ₹${minTotal.toFixed(2)}.` });
  }

  let amountPaid = total;
  if (paymentMethod === 'due') {
    amountPaid = round2(Math.max(0, Math.min(Number(req.body?.amountPaid) || 0, total)));
  }
  const amountDue = round2(Math.max(0, total - amountPaid));

  deductStock(inv, lines);
  db.setInventory(inv);

  const previousSnapshot = {
    editedAt: Date.now(),
    items: sale.items, subtotal: sale.subtotal, discountMode: sale.discountMode,
    discountAmount: sale.discountAmount, discountPercent: sale.discountPercent, total: sale.total,
    paymentMethod: sale.paymentMethod, amountPaid: sale.amountPaid, amountDue: sale.amountDue,
    customerName: sale.customerName, customerPhone: sale.customerPhone,
    paymentHistory: sale.paymentHistory,
  };
  const editHistory = [...(sale.editHistory || []), previousSnapshot].slice(-20);

  const updated = db.updateSale(sale.id, {
    items: lines, subtotal, discountMode, discountAmount, discountPercent, total,
    paymentMethod, amountPaid, amountDue, customerName, customerPhone, customerAddress,
    paymentHistory: [{ timestamp: Date.now(), amount: amountPaid, method: paymentMethod === 'due' ? 'cash' : paymentMethod, note: 'Bill updated' }],
    edited: true, lastEditedAt: Date.now(), editHistory,
  });
  res.json(stripProfit(updated, isAdminSession(req)));
});

// Record an additional payment against a "due" sale (or clear it fully).
router.post('/:id/payment', requireStaff, (req, res) => {
  const sales = db.getSales();
  const sale = sales.find((s) => s.id === req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  if (Number(sale.amountDue || 0) <= 0) return res.status(400).json({ error: 'This bill has no outstanding due' });
  const amount = round2(Math.min(Number(req.body?.amount) || 0, Number(sale.amountDue || 0)));
  if (amount <= 0) return res.status(400).json({ error: 'Enter a positive amount' });
  const method = SETTLEMENT_METHODS.includes(String(req.body?.paymentMethod || '').toLowerCase())
    ? String(req.body.paymentMethod).toLowerCase()
    : 'cash';
  const amountPaid = round2(Math.min(sale.total, sale.amountPaid + amount));
  const amountDue = round2(Math.max(0, sale.total - amountPaid));
  const paymentHistory = [...(sale.paymentHistory || []), { timestamp: Date.now(), amount, method, note: 'Payment recorded' }];
  const updated = db.updateSale(sale.id, { amountPaid, amountDue, paymentHistory });
  res.json(stripProfit(updated, isAdminSession(req)));
});

// Return items from a completed sale: restocks inventory, and optionally
// offsets the refund against that bill's own outstanding due.
router.post('/:id/return', requireAdmin, (req, res) => {
  const sales = db.getSales();
  const sale = sales.find((s) => s.id === req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });

  const settings = db.getSettings();
  if (settings.returnAllowed === false) return res.status(403).json({ error: 'Returns are currently disabled in store settings' });
  const configuredWindow = Number(settings.returnWindowDays);
  // Older settings records may not have a return window yet; preserve the
  // application's seven-day default rather than silently blocking returns.
  const windowDays = Number.isFinite(configuredWindow) ? Math.max(0, configuredWindow) : 7;
  const ageDays = Math.floor((startOfLocalDay(Date.now()) - startOfLocalDay(sale.timestamp)) / 86400000);
  if (ageDays > windowDays) return res.status(400).json({ error: `This bill is outside the ${windowDays}-day return window` });

  const requested = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!requested.length) return res.status(400).json({ error: 'Choose at least one item to return' });
  const adjustAgainstDue = !!req.body?.adjustAgainstDue;

  const alreadyReturned = returnedQtyByItem(sale);
  const returnLines = [];
  for (const r of requested) {
    const qty = Math.max(0, Number(r.qty) || 0);
    if (qty <= 0) continue;
    const line = sale.items.find((l) => l.id === r.id);
    if (!line) return res.status(400).json({ error: `Item not found on this bill` });
    const already = alreadyReturned[r.id] || 0;
    const available = line.qty - already;
    if (qty > available) {
      return res.status(400).json({ error: `Only ${available} of "${line.name}" can still be returned from this bill.` });
    }
    const unitPrice = round2(line.lineTotal / line.qty);
    returnLines.push({ id: line.id, name: line.name, qty, unitPrice, amount: round2(unitPrice * qty) });
  }
  if (!returnLines.length) return res.status(400).json({ error: 'Choose at least one item to return' });

  const refundAmount = round2(returnLines.reduce((s, l) => s + l.amount, 0));

  // Put the returned stock back.
  const inv = db.getInventory();
  returnLines.forEach((l) => {
    const invItem = inv.find((i) => i.id === l.id);
    if (invItem) invItem.quantity = Number(invItem.quantity || 0) + l.qty;
  });
  db.setInventory(inv);

  let amountAppliedToDue = 0;
  let cashRefund = refundAmount;
  let amountPaid = sale.amountPaid;
  let amountDue = sale.amountDue;
  if (adjustAgainstDue && sale.amountDue > 0) {
    amountAppliedToDue = round2(Math.min(refundAmount, sale.amountDue));
    cashRefund = round2(refundAmount - amountAppliedToDue);
    amountPaid = round2(sale.amountPaid + amountAppliedToDue);
    amountDue = round2(Math.max(0, sale.amountDue - amountAppliedToDue));
  }

  const returnRecord = {
    id: genId('RET'),
    timestamp: Date.now(),
    items: returnLines,
    refundAmount,
    amountAppliedToDue,
    cashRefund,
  };
  const returns = [...(sale.returns || []), returnRecord];
  const updated = db.updateSale(sale.id, { returns, amountPaid, amountDue });

  res.json({ return: returnRecord, sale: stripProfit(updated, isAdminSession(req)) });
});

module.exports = router;
