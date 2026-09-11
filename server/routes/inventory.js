const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { requireAdmin, requireStaff } = require('../auth');

const genId = () => 'ITM-' + crypto.randomBytes(4).toString('hex').toUpperCase();
const normalize = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');
const nonNeg = (v, fallback = 0) => Math.max(0, Number(v) || fallback);

function isStaffSession(req) {
  return !!(req.session && (req.session.role === 'admin' || req.session.role === 'employee'));
}

function publicView(item, admin) {
  if (admin) return item;
  // Employees and cashiers only receive what is needed to sell. Cost is a
  // sensitive financial field and must never cross this API boundary.
  const { costPrice, ...rest } = item;
  return rest;
}

// Never let a selling price sit below cost — that's a guaranteed loss on
// every unit sold. Cost of 0 means "not set", so nothing to compare against.
function clampSellPrice(price, costPrice) {
  const p = nonNeg(price);
  const c = nonNeg(costPrice);
  return c > 0 ? Math.max(p, c) : p;
}

// List inventory — open to the sale screen, but cost price is hidden
// unless the caller is logged in as staff (admin or employee).
router.get('/', (req, res) => {
  res.json(db.getInventory().map((i) => publicView(i, req.session?.role === 'admin')));
});

// Manual add / bill-scan single confirm. Any logged-in staff member can
// manage stock — cost price and margin math are for admin eyes only,
// enforced in the frontend and in what GET returns to non-admins.
router.post('/', requireAdmin, (req, res) => {
  const { name, code, costPrice, price, quantity, category, shortDescription, detailedDescription, supplier, frequent, imageUrl } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  const cost = nonNeg(costPrice);
  const sell = clampSellPrice(price, cost);
  const inv = db.getInventory();
  const existing = code
    ? inv.find((it) => it.code && String(it.code).trim().toLowerCase() === String(code).trim().toLowerCase())
    : null;
  if (existing) {
    existing.quantity = nonNeg(existing.quantity) + nonNeg(quantity);
    existing.costPrice = cost || existing.costPrice || 0;
    existing.price = clampSellPrice(sell, existing.costPrice);
    existing.category = category ? String(category).trim() : (existing.category || 'Uncategorized');
    if (supplier !== undefined) existing.supplier = String(supplier || '').trim().slice(0, 120);
    if (frequent !== undefined) existing.frequent = !!frequent;
    if (imageUrl !== undefined) existing.imageUrl = typeof imageUrl === 'string' ? imageUrl.slice(0, 2500000) : null;
    if (shortDescription !== undefined) existing.shortDescription = String(shortDescription).trim().slice(0, 120);
    if (detailedDescription !== undefined) existing.detailedDescription = String(detailedDescription).trim().slice(0, 2000);
    db.setInventory(inv);
    return res.json(publicView(existing, true));
  }
  const item = {
    id: genId(),
    name: String(name).trim(),
    code: code ? String(code).trim() : null,
    category: category ? String(category).trim() : 'Uncategorized',
    shortDescription: shortDescription ? String(shortDescription).trim().slice(0, 120) : '',
    detailedDescription: detailedDescription ? String(detailedDescription).trim().slice(0, 2000) : '',
    supplier: supplier ? String(supplier).trim().slice(0, 120) : '',
    frequent: !!frequent,
    imageUrl: typeof imageUrl === 'string' ? imageUrl.slice(0, 2500000) : null,
    costPrice: cost,
    price: sell,
    quantity: nonNeg(quantity),
    createdAt: Date.now(),
  };
  inv.push(item);
  db.setInventory(inv);
  res.json(publicView(item, true));
});

// Bulk add — used after reviewing a scanned bill. Any staff member.
router.post('/bulk', requireAdmin, (req, res) => {
  const rows = Array.isArray(req.body?.items) ? req.body.items : [];
  const inv = db.getInventory();
  let added = 0, updated = 0;
  rows.forEach((row) => {
    if (!row.name || !String(row.name).trim()) return;
    const cost = nonNeg(row.cost);
    const sell = clampSellPrice(row.sell, cost);
    const existing = row.code
      ? inv.find((it) => it.code && String(it.code).trim().toLowerCase() === String(row.code).trim().toLowerCase())
      : inv.find((it) => normalize(it.name) === normalize(row.name));
    if (existing) {
      existing.quantity = nonNeg(existing.quantity) + nonNeg(row.quantity);
      existing.costPrice = cost || existing.costPrice || 0;
      existing.price = clampSellPrice(sell, existing.costPrice);
      existing.category = row.category ? String(row.category).trim() : (existing.category || 'Uncategorized');
      if (row.shortDescription !== undefined) existing.shortDescription = String(row.shortDescription || '').trim().slice(0, 120);
      updated++;
    } else {
      inv.push({
        id: genId(),
        name: String(row.name).trim(),
        code: row.code ? String(row.code).trim() : null,
        category: row.category ? String(row.category).trim() : 'Uncategorized',
        shortDescription: row.shortDescription ? String(row.shortDescription).trim().slice(0, 120) : '',
        detailedDescription: '',
        supplier: row.supplier ? String(row.supplier).trim().slice(0, 120) : '',
        frequent: !!row.frequent,
        costPrice: cost,
        price: sell,
        quantity: nonNeg(row.quantity),
        createdAt: Date.now(),
      });
      added++;
    }
  });
  db.setInventory(inv);
  res.json({ added, updated });
});

router.put('/:id', requireAdmin, (req, res) => {
  const inv = db.getInventory();
  const item = inv.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const { name, code, costPrice, price, quantity, category, shortDescription, detailedDescription, supplier, frequent, imageUrl } = req.body || {};
  if (name !== undefined) item.name = String(name).trim() || item.name;
  if (code !== undefined) item.code = code ? String(code).trim() : null;
  if (category !== undefined) item.category = String(category).trim() || 'Uncategorized';
  if (shortDescription !== undefined) item.shortDescription = String(shortDescription).trim().slice(0, 120);
  if (detailedDescription !== undefined) item.detailedDescription = String(detailedDescription).trim().slice(0, 2000);
  if (supplier !== undefined) item.supplier = String(supplier || '').trim().slice(0, 120);
  if (frequent !== undefined) item.frequent = !!frequent;
  if (imageUrl !== undefined) item.imageUrl = typeof imageUrl === 'string' ? imageUrl.slice(0, 2500000) : null;
  if (costPrice !== undefined) item.costPrice = nonNeg(costPrice);
  if (price !== undefined) item.price = clampSellPrice(price, item.costPrice);
  else if (costPrice !== undefined) item.price = clampSellPrice(item.price, item.costPrice); // cost went up past the old price
  if (quantity !== undefined) item.quantity = nonNeg(quantity);
  db.setInventory(inv);
  res.json(publicView(item, true));
});

// Deleting is destructive — admin only.
router.delete('/:id', requireAdmin, (req, res) => {
  const inv = db.getInventory();
  const next = inv.filter((i) => i.id !== req.params.id);
  db.setInventory(next);
  res.json({ ok: true, removed: inv.length !== next.length });
});

module.exports = router;
