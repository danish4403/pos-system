const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAdmin, requireStaff } = require('../auth');
const router = express.Router();
const id = (p) => `${p}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const money = (v) => Math.round(Math.max(0, Number(v) || 0) * 100) / 100;

router.get('/', requireStaff, (req, res) => {
  const all = db.getExpenses();
  // Employee sees their own variable submissions only, never the full books.
  res.json(req.session.role === 'admin' ? all : all.filter(e => e.createdBy === req.session.employeeId && e.type === 'variable'));
});
router.get('/categories', requireStaff, (req, res) => res.json(db.getExpenseCategories()));
router.post('/categories', requireAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  const rows = db.getExpenseCategories();
  if (rows.some(c => String(c.name || '').trim().toLowerCase() === name.toLowerCase())) return res.status(400).json({ error: 'Category already exists' });
  const suggestedType = req.body?.suggestedType === 'fixed' ? 'fixed' : 'variable';
  const row = { id: id('ECAT'), name, suggestedType, builtIn: false, createdAt: Date.now() }; rows.push(row); db.setExpenseCategories(rows); res.json(row);
});
router.delete('/categories/:id', requireAdmin, (req, res) => { db.setExpenseCategories(db.getExpenseCategories().filter(c => c.id !== req.params.id)); res.json({ ok: true }); });
router.post('/', requireStaff, (req, res) => {
  const body = req.body || {}; const type = body.type === 'fixed' ? 'fixed' : 'variable';
  if (req.session.role !== 'admin' && type !== 'variable') return res.status(403).json({ error: 'Employees may submit variable expenses only' });
  const category = String(body.category || '').trim(); const amount = money(body.amount);
  if (!category || !amount) return res.status(400).json({ error: 'Date, category and a positive amount are required' });
  const paymentMethod = ['cash','upi','card','bank'].includes(body.paymentMethod) ? body.paymentMethod : 'cash';
  const row = { id: id('EXP'), date: /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0,10), category, description: String(body.description || '').trim().slice(0,300), amount, type, paymentMethod, createdAt: Date.now(), createdBy: req.session.role === 'admin' ? 'admin' : req.session.employeeId, approved: req.session.role === 'admin' };
  const rows = db.getExpenses(); rows.unshift(row); db.setExpenses(rows); res.json(row);
});
router.put('/:id', requireAdmin, (req, res) => { const rows=db.getExpenses(); const row=rows.find(e=>e.id===req.params.id); if(!row)return res.status(404).json({error:'Expense not found'}); ['date','category','description'].forEach(k=>{if(req.body?.[k]!==undefined)row[k]=String(req.body[k]).trim();}); if(req.body?.type!==undefined)row.type=req.body.type==='fixed'?'fixed':'variable'; if(req.body?.amount!==undefined)row.amount=money(req.body.amount); if(req.body?.approved!==undefined)row.approved=!!req.body.approved; db.setExpenses(rows);res.json(row); });
router.delete('/:id', requireAdmin, (req,res)=>{db.setExpenses(db.getExpenses().filter(e=>e.id!==req.params.id));res.json({ok:true});});
module.exports = router;
