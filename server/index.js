require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
// Bind to all interfaces so other devices on the same WiFi can reach it later
// (e.g. http://<this-computer's-LAN-IP>:3000) — harmless when used on one
// device, useful the day you add a second one.
const HOST = process.env.HOST || '0.0.0.0';

app.use(express.json({ limit: '30mb' })); // photos as base64 need headroom — several hero images at once, in particular
app.use(session({
  secret: process.env.SESSION_SECRET || 'ledger-pos-local-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 12 * 60 * 60 * 1000 }, // 12 hour admin session
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/vision', require('./routes/vision'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/attendance', require('./routes/attendance').router);
app.use('/api/imports', require('./routes/imports'));
app.use('/api/exports', require('./routes/exports'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/ai', require('./routes/ai'));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Ledger POS is running.');
  console.log(`  On this computer:  http://localhost:${PORT}`);
  console.log('');
  const db = require('./db');
  if (!db.getSettings().anthropicApiKey && !process.env.ANTHROPIC_API_KEY) {
    console.log('  ⚠  No Anthropic API key configured yet — photo scanning will not work');
    console.log('     until you add one in the app\'s Settings page. Manual entry still works.');
    console.log('');
  }
});
