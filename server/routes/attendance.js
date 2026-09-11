const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAdmin, requireStaff } = require('../auth');

const router = express.Router();
const id = (prefix) => `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const localDate = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const today = () => localDate();
const validDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const statuses = new Set(['present', 'absent', 'half_day', 'paid_leave', 'unpaid_leave']);
const specialTypes = new Set(['normal', 'sunday', 'holiday', 'overtime', 'special']);

function publicEmployee(e) {
  const { passwordHash, passwordSalt, ...rest } = e;
  return rest;
}

function automaticAttendance(employeeId, when = new Date()) {
  const date = localDate(when);
  const at = when.toISOString();
  const rows = db.getAttendance();
  let row = rows.find((r) => r.employeeId === employeeId && r.date === date);
  if (!row) {
    row = { id: id('ATT'), employeeId, date, status: 'present', checkIn: at, checkOut: '', notes: '', source: 'automatic', updatedAt: Date.now() };
    rows.push(row);
  } else if (!row.checkIn) {
    row.checkIn = at;
    row.status = row.status || 'present';
    row.updatedAt = Date.now();
  }
  db.setAttendance(rows);
  return row;
}

function closeAutomaticAttendance(employeeId, when = new Date()) {
  const date = localDate(when);
  const rows = db.getAttendance();
  const row = rows.find((r) => r.employeeId === employeeId && r.date === date);
  if (row && !row.checkOut) { row.checkOut = when.toISOString(); row.updatedAt = Date.now(); db.setAttendance(rows); }
  return row;
}

function monthBounds(month) {
  const m = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : today().slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  const nextMonth = new Date(y, mo, 1);
  return { month: m, start: `${m}-01`, end: localDate(nextMonth) };
}

function salaryForEmployee(employee, month) {
  const bounds = monthBounds(month);
  const dailySalary = Number(employee.monthlySalary || 0) / 30;
  const records = db.getAttendance().filter((r) => r.employeeId === employee.id && r.date >= bounds.start && r.date < bounds.end);
  const counts = { present: 0, absent: 0, half_day: 0, paid_leave: 0, unpaid_leave: 0 };
  records.forEach((r) => { if (counts[r.status] !== undefined) counts[r.status] += 1; });
  const attendanceSalary = (counts.present + counts.paid_leave) * dailySalary + counts.half_day * dailySalary * 0.5;
  const specials = db.getSpecialDays().filter((r) => r.employeeId === employee.id && r.date >= bounds.start && r.date < bounds.end && r.type !== 'normal');
  const setting = db.getSettings();
  const multiplier = Number(setting.overtimeMultiplier) || 2;
  const overtime = specials.reduce((sum, r) => sum + (r.customAmount !== null && r.customAmount !== undefined && r.customAmount !== '' ? Number(r.customAmount) : setting.overtimeCustomAmount !== null && setting.overtimeCustomAmount !== undefined ? Number(setting.overtimeCustomAmount) : dailySalary * (Number(r.multiplier) || multiplier)), 0);
  const adjustments = db.getSalaryAdjustments().filter((r) => r.employeeId === employee.id && r.date >= bounds.start && r.date < bounds.end);
  const additions = adjustments.filter((r) => r.kind === 'addition').reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const deductions = adjustments.filter((r) => r.kind === 'deduction').reduce((sum, r) => sum + Number(r.amount || 0), 0);
  return { employee: publicEmployee(employee), month: bounds.month, monthlySalary: money(employee.monthlySalary), dailySalary: money(dailySalary), counts, presentDays: counts.present, absentDays: counts.absent, halfDays: counts.half_day, paidLeaveDays: counts.paid_leave, unpaidLeaveDays: counts.unpaid_leave, specialDays: specials.length, attendanceSalary: money(attendanceSalary), overtimePayment: money(overtime), additions: money(additions), deductions: money(deductions), adjustments, finalPayable: money(attendanceSalary + overtime + additions - deductions), specialRecords: specials };
}

router.get('/settings', requireAdmin, (req, res) => {
  const settings = db.getSettings();
  res.json({ attendanceMode: settings.attendanceMode === 'manual' ? 'manual' : 'automatic', overtimeMultiplier: Number(settings.overtimeMultiplier) || 2, overtimeCustomAmount: settings.overtimeCustomAmount ?? null });
});

router.put('/settings', requireAdmin, (req, res) => {
  const body = req.body || {};
  const attendanceMode = body.attendanceMode === 'manual' ? 'manual' : 'automatic';
  const allowed = [2, 1.5, 1];
  const overtimeMultiplier = allowed.includes(Number(body.overtimeMultiplier)) ? Number(body.overtimeMultiplier) : 2;
  const overtimeCustomAmount = body.overtimeCustomAmount === '' || body.overtimeCustomAmount === null || body.overtimeCustomAmount === undefined ? null : Math.max(0, Number(body.overtimeCustomAmount) || 0);
  db.setSettings({ attendanceMode, overtimeMultiplier, overtimeCustomAmount });
  res.json({ attendanceMode, overtimeMultiplier, overtimeCustomAmount });
});

router.get('/', requireStaff, (req, res) => {
  const rows = db.getAttendance();
  if (req.session.role === 'employee') return res.json(rows.filter((r) => r.employeeId === req.session.employeeId));
  const month = req.query.month;
  const date = req.query.date;
  const filtered = date && validDate(date) ? rows.filter((r) => r.date === date) : month && /^\d{4}-\d{2}$/.test(String(month)) ? rows.filter((r) => r.date.startsWith(month)) : rows;
  res.json(filtered);
});

router.post('/', requireAdmin, (req, res) => {
  const body = req.body || {};
  const employee = db.getEmployees().find((e) => e.id === body.employeeId && e.active !== false);
  if (!employee) return res.status(400).json({ error: 'Select an active employee' });
  if (!validDate(body.date)) return res.status(400).json({ error: 'A valid attendance date is required' });
  if (!statuses.has(body.status)) return res.status(400).json({ error: 'Invalid attendance status' });
  const rows = db.getAttendance();
  if (rows.some((r) => r.employeeId === employee.id && r.date === body.date)) return res.status(409).json({ error: 'Attendance already exists for this employee and date' });
  const row = { id: id('ATT'), employeeId: employee.id, date: body.date, status: body.status, checkIn: String(body.checkIn || ''), checkOut: String(body.checkOut || ''), notes: String(body.notes || '').trim().slice(0, 500), source: 'manual', updatedAt: Date.now() };
  rows.push(row); db.setAttendance(rows); res.json(row);
});

router.get('/special-days', requireAdmin, (req, res) => {
  const month = req.query.month; const rows = db.getSpecialDays();
  res.json(month && /^\d{4}-\d{2}$/.test(String(month)) ? rows.filter((r) => r.date.startsWith(month)) : rows);
});

router.post('/special-days', requireAdmin, (req, res) => {
  const body = req.body || {};
  if (!validDate(body.date) || !specialTypes.has(body.type)) return res.status(400).json({ error: 'Date and special day type are required' });
  const employee = db.getEmployees().find((e) => e.id === body.employeeId && e.active !== false);
  if (!employee) return res.status(400).json({ error: 'Select an active employee' });
  const rows = db.getSpecialDays();
  if (rows.some((r) => r.employeeId === employee.id && r.date === body.date)) return res.status(409).json({ error: 'A special day already exists for this employee and date' });
  const row = { id: id('SPC'), employeeId: employee.id, date: body.date, type: body.type, multiplier: Number(body.multiplier) || null, customAmount: body.customAmount === '' || body.customAmount === null || body.customAmount === undefined ? null : Math.max(0, Number(body.customAmount) || 0), notes: String(body.notes || '').trim().slice(0, 500), createdAt: Date.now() };
  rows.push(row); db.setSpecialDays(rows); res.json(row);
});

router.put('/special-days/:id', requireAdmin, (req, res) => {
  const rows = db.getSpecialDays(); const row = rows.find((r) => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Special day not found' });
  const body = req.body || {};
  if (body.type !== undefined && !specialTypes.has(body.type)) return res.status(400).json({ error: 'Invalid special day type' });
  ['date', 'type', 'notes'].forEach((key) => { if (body[key] !== undefined) row[key] = key === 'notes' ? String(body[key] || '').trim().slice(0, 500) : body[key]; });
  if (body.multiplier !== undefined) row.multiplier = Number(body.multiplier) || null;
  if (body.customAmount !== undefined) row.customAmount = body.customAmount === '' || body.customAmount === null ? null : Math.max(0, Number(body.customAmount) || 0);
  db.setSpecialDays(rows); res.json(row);
});

router.delete('/special-days/:id', requireAdmin, (req, res) => { db.setSpecialDays(db.getSpecialDays().filter((r) => r.id !== req.params.id)); res.json({ ok: true }); });

router.put('/:id', requireAdmin, (req, res) => {
  const rows = db.getAttendance(); const row = rows.find((r) => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Attendance record not found' });
  const body = req.body || {};
  if (body.status !== undefined && !statuses.has(body.status)) return res.status(400).json({ error: 'Invalid attendance status' });
  if (body.status !== undefined) row.status = body.status;
  if (body.checkIn !== undefined) row.checkIn = String(body.checkIn || '');
  if (body.checkOut !== undefined) row.checkOut = String(body.checkOut || '');
  if (body.notes !== undefined) row.notes = String(body.notes || '').trim().slice(0, 500);
  row.updatedAt = Date.now(); db.setAttendance(rows); res.json(row);
});

router.get('/salary', requireAdmin, (req, res) => {
  const month = monthBounds(req.query.month).month;
  res.json(db.getEmployees().map((e) => salaryForEmployee(e, month)));
});

router.get('/salary/:employeeId', requireAdmin, (req, res) => {
  const employee = db.getEmployees().find((e) => e.id === req.params.employeeId);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  res.json(salaryForEmployee(employee, monthBounds(req.query.month).month));
});

router.post('/adjustments', requireAdmin, (req, res) => {
  const body = req.body || {};
  if (!db.getEmployees().some((e) => e.id === body.employeeId)) return res.status(400).json({ error: 'Employee not found' });
  if (!['addition', 'deduction'].includes(body.kind)) return res.status(400).json({ error: 'Adjustment type must be addition or deduction' });
  if (!Number(body.amount) || Number(body.amount) < 0 || !validDate(body.date)) return res.status(400).json({ error: 'Date and a positive amount are required' });
  const row = { id: id('ADJ'), employeeId: body.employeeId, kind: body.kind, category: String(body.category || (body.kind === 'addition' ? 'Bonus' : 'Other Deduction')).trim().slice(0, 100), amount: money(body.amount), reason: String(body.reason || '').trim().slice(0, 300), date: body.date, createdAt: Date.now() };
  const rows = db.getSalaryAdjustments(); rows.push(row); db.setSalaryAdjustments(rows); res.json(row);
});

router.delete('/adjustments/:id', requireAdmin, (req, res) => { db.setSalaryAdjustments(db.getSalaryAdjustments().filter((r) => r.id !== req.params.id)); res.json({ ok: true }); });

router.delete('/:id', requireAdmin, (req, res) => { db.setAttendance(db.getAttendance().filter((r) => r.id !== req.params.id)); res.json({ ok: true }); });

module.exports = { router, automaticAttendance, closeAutomaticAttendance };
