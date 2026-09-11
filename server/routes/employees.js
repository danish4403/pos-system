const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const { requireAdmin } = require('../auth');
const { sanitizePhone } = require('../util');

const genId = () => 'EMP-' + crypto.randomBytes(4).toString('hex').toUpperCase();

function publicView(e) {
  const { passwordHash, passwordSalt, ...rest } = e;
  return rest;
}

router.get('/', requireAdmin, (req, res) => {
  res.json(db.getEmployees().map(publicView));
});

router.post('/', requireAdmin, (req, res) => {
  const { name, username, password, discountLimitPercent, mobile, address, joiningDate, position, monthlySalary, notes } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  if (!username || !String(username).trim()) return res.status(400).json({ error: 'Username is required' });
  if (!password || String(password).length < 4) return res.status(400).json({ error: 'Choose a password with at least 4 characters' });
  if (auth.findEmployeeByUsername(username)) return res.status(400).json({ error: 'That username is already taken' });
  const rawMobile = String(mobile || '').replace(/\D/g, '');
  const cleanMobile = sanitizePhone(mobile);
  if (mobile && (rawMobile.length !== 10 || cleanMobile.length !== 10)) return res.status(400).json({ error: 'Mobile number must contain exactly 10 digits' });

  const { salt, hash } = auth.hashEmployeePassword(password);
  const employees = db.getEmployees();
  const employee = {
    id: genId(),
    name: String(name).trim(),
    username: String(username).trim().toLowerCase(),
    mobile: cleanMobile,
    address: String(address || '').trim().slice(0, 500),
    joiningDate: /^\d{4}-\d{2}-\d{2}$/.test(String(joiningDate || '')) ? joiningDate : new Date().toISOString().slice(0, 10),
    position: String(position || '').trim().slice(0, 100),
    monthlySalary: Math.max(0, Number(monthlySalary) || 0),
    notes: String(notes || '').trim().slice(0, 500),
    passwordHash: hash,
    passwordSalt: salt,
    discountLimitPercent: discountLimitPercent === undefined || discountLimitPercent === null || discountLimitPercent === ''
      ? null : Math.max(0, Math.min(100, Number(discountLimitPercent) || 0)),
    active: true,
    createdAt: Date.now(),
  };
  employees.push(employee);
  db.setEmployees(employees);
  res.json(publicView(employee));
});

router.put('/:id', requireAdmin, (req, res) => {
  const employees = db.getEmployees();
  const emp = employees.find((e) => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  const { name, discountLimitPercent, active, newPassword, username, mobile, address, joiningDate, position, monthlySalary, notes } = req.body || {};
  if (name !== undefined) emp.name = String(name).trim() || emp.name;
  if (username !== undefined && String(username).trim()) {
    const existing = auth.findEmployeeByUsername(username);
    if (existing && existing.id !== emp.id) return res.status(400).json({ error: 'That username is already taken' });
    emp.username = String(username).trim().toLowerCase();
  }
  if (discountLimitPercent !== undefined) {
    emp.discountLimitPercent = discountLimitPercent === null || discountLimitPercent === ''
      ? null : Math.max(0, Math.min(100, Number(discountLimitPercent) || 0));
  }
  if (active !== undefined) emp.active = !!active;
  if (mobile !== undefined) {
    const rawMobile = String(mobile || '').replace(/\D/g, '');
    const cleanMobile = sanitizePhone(mobile);
    if (mobile && (rawMobile.length !== 10 || cleanMobile.length !== 10)) return res.status(400).json({ error: 'Mobile number must contain exactly 10 digits' });
    emp.mobile = cleanMobile;
  }
  if (address !== undefined) emp.address = String(address || '').trim().slice(0, 500);
  if (joiningDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(joiningDate))) emp.joiningDate = joiningDate;
  if (position !== undefined) emp.position = String(position || '').trim().slice(0, 100);
  if (monthlySalary !== undefined) emp.monthlySalary = Math.max(0, Number(monthlySalary) || 0);
  if (notes !== undefined) emp.notes = String(notes || '').trim().slice(0, 500);
  if (newPassword) {
    if (String(newPassword).length < 4) return res.status(400).json({ error: 'Choose a password with at least 4 characters' });
    const { salt, hash } = auth.hashEmployeePassword(newPassword);
    emp.passwordSalt = salt;
    emp.passwordHash = hash;
  }
  db.setEmployees(employees);
  res.json(publicView(emp));
});

router.delete('/:id', requireAdmin, (req, res) => {
  const employees = db.getEmployees();
  const next = employees.filter((e) => e.id !== req.params.id);
  db.setEmployees(next);
  res.json({ ok: true, removed: employees.length !== next.length });
});

module.exports = router;
