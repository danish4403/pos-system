// Lightweight embedded database.
// Stores each collection as a JSON file under /data. No native/compiled
// dependencies — this is deliberate so `npm install` works on any machine
// (Windows/Mac/Linux) without build tools. Fine for a single shop's catalog
// and sales history (thousands of records, not millions).
//
// If this ever needs to scale to multiple synced devices/locations, swap
// this module for a real client-server database (e.g. PostgreSQL) — every
// route file only talks to the functions exported here, so that's a
// contained change.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.POS_DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  inventory: path.join(DATA_DIR, 'inventory.json'),
  sales: path.join(DATA_DIR, 'sales.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  discountApprovals: path.join(DATA_DIR, 'discount_approvals.json'),
  employees: path.join(DATA_DIR, 'employees.json'),
  customers: path.join(DATA_DIR, 'customers.json'),
  expenses: path.join(DATA_DIR, 'expenses.json'),
  expenseCategories: path.join(DATA_DIR, 'expense_categories.json'),
  dailyClosings: path.join(DATA_DIR, 'daily_closings.json'),
  attendance: path.join(DATA_DIR, 'attendance.json'),
  specialDays: path.join(DATA_DIR, 'special_days.json'),
  salaryAdjustments: path.join(DATA_DIR, 'salary_adjustments.json'),
};

const DEFAULT_SETTINGS = {
  defaultMarginPercent: 30,
  currencySymbol: '₹',
  shopName: 'My Shop',
  shopAddress: '',
  shopPhone: '',
  welcomeMessage: 'Welcome! Ready when you are.',
  additionalPhone: '', // shown alongside the main shop phone on the Home page
  backgroundImage: null, // deprecated single-image field — kept only so old data still loads; see backgroundImages
  backgroundImages: [], // data URLs for the Home page hero carousel
  billFooterMessage: 'Thank You for Visiting',
  uiFontSize: 'md', // 'sm' | 'md' | 'lg'
  accentColor: '#B8863B',
  theme: 'general',
  language: 'en',
  shopTagline: '',
  storeLogo: null,
  frequentGridColumns: 4,
  receiptWidth: 'standard', // 'narrow' | 'standard' | 'wide'
  maxEmployeeDiscountPercent: 10, // discounts above this need manager approval
  attendanceMode: 'automatic',
  overtimeMultiplier: 2,
  overtimeCustomAmount: null,
  businessCity: '', businessState: '', businessPinCode: '', businessEmail: '',
  gstin: '', legalBusinessName: '', tradeName: '', panNumber: '', businessRegistrationNumber: '',
  gstRegistrationStatus: 'unregistered', defaultGstRate: '', msmeUdyamNumber: '', shopEstablishmentNumber: '',
  invoicePrefix: 'INV-', startingInvoiceNumber: 1, invoiceTitle: 'Invoice', invoiceFontSize: 'md',
  returnAllowed: true, returnWindowDays: 7, returnConditions: '', exchangeAllowed: true, exchangeWindowDays: 7, exchangeConditions: '',
  termsAndConditions: '', showPoliciesOnInvoice: false,
  upiId: '', bankName: '', accountHolderName: '', accountNumber: '', ifscCode: '', showPaymentDetailsOnInvoice: false,
  website: '', instagram: '', facebook: '', googleBusinessLink: '', showOnlineDetailsOnInvoice: false,
  invoiceDisplay: { logo: true, address: true, mobile: true, gstin: true, customer: true, policies: false, terms: false, payment: false, thankYou: true },
  anthropicApiKey: null, // set via Settings — no .env editing needed once installed
  // Plaintext-free: we store a salted hash, never the raw password.
  adminPasswordHash: null,
  adminPasswordSalt: null,
};

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Could not read ${file}, using fallback.`, err.message);
    return fallback;
  }
}

function writeJson(file, data) {
  // Write to a temp file then rename — avoids a half-written file if the
  // process is killed mid-write.
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// ---- in-memory cache, write-through to disk on every mutation ----
let inventory = readJson(FILES.inventory, []);
let sales = readJson(FILES.sales, []);
let settings = Object.assign({}, DEFAULT_SETTINGS, readJson(FILES.settings, {}));
if (!fs.existsSync(FILES.settings)) writeJson(FILES.settings, settings);
let discountApprovals = readJson(FILES.discountApprovals, []);
let employees = readJson(FILES.employees, []);
let customers = readJson(FILES.customers, []);
let expenses = readJson(FILES.expenses, []);
const DEFAULT_EXPENSE_CATEGORIES = [
  ['Rent', 'fixed'], ['Employee Salary', 'fixed'], ['Electricity Bill', 'variable'],
  ['Internet Bill', 'fixed'], ['Water Bill', 'variable'], ['Shop Maintenance', 'fixed'],
  ['Software / Subscription', 'fixed'], ['Insurance', 'fixed'], ['Transport', 'variable'],
  ['Delivery Charges', 'variable'], ['Packaging', 'variable'], ['Cleaning', 'variable'],
  ['Repairs & Maintenance', 'variable'], ['Marketing / Advertising', 'variable'],
  ['Stationery', 'variable'], ['Miscellaneous', 'variable'], ['Bank Charges', 'variable'],
  ['Taxes / Fees', 'fixed'], ['Supplier-related Expenses', 'variable'], ['Travel', 'variable'],
  ['Other', 'variable'],
].map(([name, suggestedType]) => ({ name, suggestedType }));
let expenseCategories = readJson(FILES.expenseCategories, []);
// Seed built-ins once, while preserving custom categories and normalizing any
// case-only matches (for example an older custom "rent" entry).
let expenseCategoriesChanged = false;
const missingExpenseCategories = [];
DEFAULT_EXPENSE_CATEGORIES.forEach((category) => {
  const existing = expenseCategories.find(c => String(c.name || '').trim().toLowerCase() === category.name.toLowerCase());
  if (existing) {
    if (existing.name !== category.name || existing.suggestedType !== category.suggestedType || existing.builtIn !== true) {
      Object.assign(existing, category, { builtIn: true });
      expenseCategoriesChanged = true;
    }
  } else {
    missingExpenseCategories.push({ id: `ECAT-DEFAULT-${category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, ...category, builtIn: true, createdAt: Date.now() });
  }
});
if (missingExpenseCategories.length) { expenseCategories = [...missingExpenseCategories, ...expenseCategories]; expenseCategoriesChanged = true; }
if (expenseCategoriesChanged) writeJson(FILES.expenseCategories, expenseCategories);
let dailyClosings = readJson(FILES.dailyClosings, []);
let attendance = readJson(FILES.attendance, []);
let specialDays = readJson(FILES.specialDays, []);
let salaryAdjustments = readJson(FILES.salaryAdjustments, []);

module.exports = {
  // ---- inventory ----
  getInventory: () => inventory,
  setInventory: (next) => { inventory = next; writeJson(FILES.inventory, inventory); },

  // ---- sales ----
  getSales: () => sales,
  addSale: (sale) => { sales.unshift(sale); writeJson(FILES.sales, sales); },
  updateSale: (id, patch) => {
    const sale = sales.find((s) => s.id === id);
    if (!sale) return null;
    Object.assign(sale, patch);
    writeJson(FILES.sales, sales);
    return sale;
  },

  // ---- settings ----
  getSettings: () => settings,
  setSettings: (next) => { settings = Object.assign({}, settings, next); writeJson(FILES.settings, settings); },

  // ---- discount approval audit log (extra-discount authorizations) ----
  getDiscountApprovals: () => discountApprovals,
  addDiscountApproval: (entry) => { discountApprovals.unshift(entry); writeJson(FILES.discountApprovals, discountApprovals); },

  // ---- employees ----
  getEmployees: () => employees,
  setEmployees: (next) => { employees = next; writeJson(FILES.employees, employees); },

  // ---- customers / expenses ----
  getCustomers: () => customers,
  setCustomers: (next) => { customers = next; writeJson(FILES.customers, customers); },
  getExpenses: () => expenses,
  setExpenses: (next) => { expenses = next; writeJson(FILES.expenses, expenses); },
  getExpenseCategories: () => expenseCategories,
  setExpenseCategories: (next) => { expenseCategories = next; writeJson(FILES.expenseCategories, expenseCategories); },
  getDailyClosings: () => dailyClosings,
  setDailyClosings: (next) => { dailyClosings = next; writeJson(FILES.dailyClosings, dailyClosings); },
  getAttendance: () => attendance,
  setAttendance: (next) => { attendance = next; writeJson(FILES.attendance, attendance); },
  getSpecialDays: () => specialDays,
  setSpecialDays: (next) => { specialDays = next; writeJson(FILES.specialDays, specialDays); },
  getSalaryAdjustments: () => salaryAdjustments,
  setSalaryAdjustments: (next) => { salaryAdjustments = next; writeJson(FILES.salaryAdjustments, salaryAdjustments); },
};
