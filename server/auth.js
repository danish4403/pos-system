// Role-based authentication: two roles share this codebase —
//  - "admin": the shop owner. Full access, including cost price, margin,
//    profit, revenue, settings, and employee management.
//  - "employee": staff accounts the admin creates. Can sell (though selling
//    itself never requires login), manage inventory, view sales history,
//    edit/return bills — but never sees cost price, margin, profit, or
//    revenue figures, and can't touch settings or employee management.
//
// Everyday selling never requires a login at all — only actions an owner
// or staff member would want tracked/locked down go through requireStaff
// or requireAdmin below.

const crypto = require('crypto');
const db = require('./db');

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---- admin ----
function setAdminPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  db.setSettings({ adminPasswordSalt: salt, adminPasswordHash: hash });
}
function verifyAdminPassword(password) {
  const settings = db.getSettings();
  if (!settings.adminPasswordHash || !settings.adminPasswordSalt) return false;
  return timingSafeEqualHex(hashPassword(password, settings.adminPasswordSalt), settings.adminPasswordHash);
}
function isAdminConfigured() {
  const settings = db.getSettings();
  return !!(settings.adminPasswordHash && settings.adminPasswordSalt);
}

// ---- employees ----
function hashEmployeePassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: hashPassword(password, salt) };
}
function findEmployeeByUsername(username) {
  const u = String(username || '').trim().toLowerCase();
  return db.getEmployees().find((e) => e.username.toLowerCase() === u);
}
function verifyEmployeeLogin(username, password) {
  const emp = findEmployeeByUsername(username);
  if (!emp || !emp.active) return null;
  if (!timingSafeEqualHex(hashPassword(password, emp.passwordSalt), emp.passwordHash)) return null;
  return emp;
}

// ---- session middleware ----
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.status(401).json({ error: 'Admin login required' });
}
function requireStaff(req, res, next) {
  if (req.session && (req.session.role === 'admin' || req.session.role === 'employee')) return next();
  return res.status(401).json({ error: 'Staff login required' });
}

module.exports = {
  setAdminPassword, verifyAdminPassword, isAdminConfigured,
  hashEmployeePassword, findEmployeeByUsername, verifyEmployeeLogin,
  requireAdmin, requireStaff,
};
