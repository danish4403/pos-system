const express = require('express');
const router = express.Router();
const auth = require('../auth');
const db = require('../db');
const { automaticAttendance, closeAutomaticAttendance } = require('./attendance');

// Is admin set up yet, and what (if anything) is *this* session logged in as.
router.get('/status', (req, res) => {
  res.json({
    configured: auth.isAdminConfigured(),
    loggedIn: !!(req.session && req.session.role),
    role: (req.session && req.session.role) || null,
    name: (req.session && req.session.role === 'employee') ? req.session.employeeName : null,
  });
});

// First-run: set the admin password. Only allowed while none is configured
// yet — after that, changing it requires being logged in (see settings route).
router.post('/setup', (req, res) => {
  if (auth.isAdminConfigured()) {
    return res.status(400).json({ error: 'Admin password already set. Log in to change it.' });
  }
  const { password } = req.body || {};
  if (!password || String(password).length < 4) {
    return res.status(400).json({ error: 'Choose a password with at least 4 characters.' });
  }
  auth.setAdminPassword(password);
  req.session.role = 'admin';
  res.json({ ok: true, role: 'admin' });
});

// Logs in as either the admin, or a named employee.
router.post('/login', (req, res) => {
  const { role, username, password } = req.body || {};

  if (role === 'employee') {
    const emp = auth.verifyEmployeeLogin(username, password || '');
    if (!emp) return res.status(401).json({ error: 'Incorrect username or password' });
    req.session.role = 'employee';
    req.session.employeeId = emp.id;
    req.session.employeeName = emp.name;
    if (db.getSettings().attendanceMode !== 'manual') automaticAttendance(emp.id);
    return res.json({ ok: true, role: 'employee', name: emp.name });
  }

  if (!auth.verifyAdminPassword(password || '')) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  req.session.role = 'admin';
  req.session.employeeId = null;
  req.session.employeeName = null;
  res.json({ ok: true, role: 'admin' });
});

router.post('/logout', (req, res) => {
  if (req.session?.role === 'employee' && db.getSettings().attendanceMode !== 'manual') closeAutomaticAttendance(req.session.employeeId);
  req.session.role = null;
  req.session.employeeId = null;
  req.session.employeeName = null;
  res.json({ ok: true });
});

module.exports = router;
