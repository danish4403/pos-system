const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../auth');
const { requireAdmin } = require('../auth');

const FONT_SIZES = ['sm', 'md', 'lg'];
const RECEIPT_WIDTHS = ['narrow', 'standard', 'wide'];
const INVOICE_TITLES = ['Invoice', 'Tax Invoice', 'Retail Invoice'];
const GST_STATUSES = ['registered', 'unregistered', 'composition'];
const INVOICE_FONT_SIZES = ['sm', 'md', 'lg'];

// Non-sensitive settings the sale screen / home page need even when logged out.
router.get('/', (req, res) => {
  const s = db.getSettings();
  const isAdmin = !!(req.session && req.session.role === 'admin');
  // Migration: older installs only ever stored one `backgroundImage`. If the
  // carousel array is empty but a legacy image exists, surface it as the
  // first (only) slide so existing data keeps showing up.
  const backgroundImages = (Array.isArray(s.backgroundImages) && s.backgroundImages.length)
    ? s.backgroundImages
    : (s.backgroundImage ? [s.backgroundImage] : []);
  const response = {
    currencySymbol: s.currencySymbol,
    shopName: s.shopName,
    shopAddress: s.shopAddress,
    shopPhone: s.shopPhone,
    storeLogo: s.storeLogo,
    additionalPhone: s.additionalPhone,
    welcomeMessage: s.welcomeMessage,
    backgroundImages,
    billFooterMessage: s.billFooterMessage,
    uiFontSize: s.uiFontSize,
    accentColor: s.accentColor, theme: s.theme, language: s.language, shopTagline: s.shopTagline, frequentGridColumns: s.frequentGridColumns,
    receiptWidth: s.receiptWidth,
    defaultMarginPercent: s.defaultMarginPercent,
    // Cashiers need to know the limit to explain why checkout is blocking
    // them, but the value itself isn't sensitive.
    maxEmployeeDiscountPercent: s.maxEmployeeDiscountPercent,
    // Never send the raw key back — just whether one is configured, and
    // only tell admins that much.
    hasApiKey: isAdmin ? !!(s.anthropicApiKey || process.env.ANTHROPIC_API_KEY) : undefined,
    businessCity: s.businessCity, businessState: s.businessState, businessPinCode: s.businessPinCode, businessEmail: s.businessEmail,
    gstin: s.gstin, legalBusinessName: s.legalBusinessName, tradeName: s.tradeName, gstRegistrationStatus: s.gstRegistrationStatus, defaultGstRate: s.defaultGstRate,
    invoicePrefix: s.invoicePrefix, startingInvoiceNumber: s.startingInvoiceNumber, invoiceTitle: s.invoiceTitle, invoiceFontSize: s.invoiceFontSize,
    returnAllowed: s.returnAllowed, returnWindowDays: s.returnWindowDays, returnConditions: s.returnConditions, exchangeAllowed: s.exchangeAllowed, exchangeWindowDays: s.exchangeWindowDays, exchangeConditions: s.exchangeConditions, termsAndConditions: s.termsAndConditions, showPoliciesOnInvoice: s.showPoliciesOnInvoice,
    invoiceDisplay: s.invoiceDisplay,
  };
  if (isAdmin) Object.assign(response, { panNumber: s.panNumber, businessRegistrationNumber: s.businessRegistrationNumber, msmeUdyamNumber: s.msmeUdyamNumber, shopEstablishmentNumber: s.shopEstablishmentNumber, upiId: s.upiId, bankName: s.bankName, accountHolderName: s.accountHolderName, accountNumber: s.accountNumber, ifscCode: s.ifscCode, showPaymentDetailsOnInvoice: s.showPaymentDetailsOnInvoice, website: s.website, instagram: s.instagram, facebook: s.facebook, googleBusinessLink: s.googleBusinessLink, showOnlineDetailsOnInvoice: s.showOnlineDetailsOnInvoice });
  res.json(response);
});

const MAX_HERO_IMAGES = 8;
const MAX_IMAGE_CHARS = 2_500_000; // ~1.8MB decoded — plenty for a resized photo

router.put('/', requireAdmin, (req, res) => {
  const {
    currencySymbol, shopName, shopAddress, shopPhone, additionalPhone, welcomeMessage,
    backgroundImages, billFooterMessage, uiFontSize, accentColor, receiptWidth,
    defaultMarginPercent, maxEmployeeDiscountPercent, anthropicApiKey, theme, language, shopTagline, frequentGridColumns, storeLogo,
    businessCity, businessState, businessPinCode, businessEmail, gstin, legalBusinessName, tradeName, panNumber, businessRegistrationNumber, gstRegistrationStatus, defaultGstRate, msmeUdyamNumber, shopEstablishmentNumber,
    invoicePrefix, startingInvoiceNumber, invoiceTitle, invoiceFontSize, returnAllowed, returnWindowDays, returnConditions, exchangeAllowed, exchangeWindowDays, exchangeConditions, termsAndConditions, showPoliciesOnInvoice,
    upiId, bankName, accountHolderName, accountNumber, ifscCode, showPaymentDetailsOnInvoice, website, instagram, facebook, googleBusinessLink, showOnlineDetailsOnInvoice, invoiceDisplay,
  } = req.body || {};
  const next = {};
  if (currencySymbol !== undefined) next.currencySymbol = String(currencySymbol).slice(0, 4);
  if (shopName !== undefined) next.shopName = String(shopName).slice(0, 60);
  if (shopAddress !== undefined) next.shopAddress = String(shopAddress).slice(0, 200);
  if (shopPhone !== undefined) {
    const raw = String(shopPhone).trim();
    if (raw && !/^\d{10}$/.test(raw)) return res.status(400).json({ error: 'Primary mobile number must contain exactly 10 digits' });
    next.shopPhone = raw;
  }
  if (additionalPhone !== undefined) {
    const raw = String(additionalPhone).trim();
    if (raw && !/^\d{10}$/.test(raw)) return res.status(400).json({ error: 'Additional contact number must contain exactly 10 digits' });
    next.additionalPhone = raw;
  }
  if (welcomeMessage !== undefined) next.welcomeMessage = String(welcomeMessage).slice(0, 200);
  if (backgroundImages !== undefined) {
    const arr = Array.isArray(backgroundImages) ? backgroundImages : [];
    next.backgroundImages = arr
      .filter((s) => typeof s === 'string' && s.length > 0)
      .slice(0, MAX_HERO_IMAGES)
      .map((s) => s.slice(0, MAX_IMAGE_CHARS));
    next.backgroundImage = null; // fully migrated once the carousel is saved from the app
  }
  if (billFooterMessage !== undefined) next.billFooterMessage = String(billFooterMessage).slice(0, 120) || 'Thank You for Visiting';
  if (uiFontSize !== undefined && FONT_SIZES.includes(uiFontSize)) next.uiFontSize = uiFontSize;
  if (accentColor !== undefined && /^#[0-9a-fA-F]{6}$/.test(accentColor)) next.accentColor = accentColor;
  if (theme !== undefined && ['general','grocery','footwear','fashion'].includes(theme)) next.theme = theme;
  if (language !== undefined && ['en','hi'].includes(language)) next.language = language;
  if (shopTagline !== undefined) next.shopTagline = String(shopTagline).slice(0, 100);
  if (storeLogo !== undefined) next.storeLogo = typeof storeLogo === 'string' && storeLogo.startsWith('data:image/') ? storeLogo.slice(0, MAX_IMAGE_CHARS) : null;
  if (frequentGridColumns !== undefined) next.frequentGridColumns = Math.max(2, Math.min(8, Number(frequentGridColumns) || 4));
  if (receiptWidth !== undefined && RECEIPT_WIDTHS.includes(receiptWidth)) next.receiptWidth = receiptWidth;
  if (defaultMarginPercent !== undefined) next.defaultMarginPercent = Number(defaultMarginPercent) || 0;
  if (maxEmployeeDiscountPercent !== undefined) next.maxEmployeeDiscountPercent = Math.max(0, Math.min(100, Number(maxEmployeeDiscountPercent) || 0));
  if (businessCity !== undefined) next.businessCity = String(businessCity).slice(0, 80);
  if (businessState !== undefined) next.businessState = String(businessState).slice(0, 80);
  if (businessPinCode !== undefined) { const pin = String(businessPinCode).trim(); if (pin && !/^\d{6}$/.test(pin)) return res.status(400).json({ error: 'PIN code must contain 6 digits' }); next.businessPinCode = pin; }
  if (businessEmail !== undefined) { const email = String(businessEmail).trim(); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' }); next.businessEmail = email.slice(0, 120); }
  if (gstin !== undefined) { const value = String(gstin).trim().toUpperCase(); if (value && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(value)) return res.status(400).json({ error: 'GSTIN must be a valid 15-character GSTIN' }); next.gstin = value; }
  if (panNumber !== undefined) { const value = String(panNumber).trim().toUpperCase(); if (value && !/^[A-Z]{5}\d{4}[A-Z]$/.test(value)) return res.status(400).json({ error: 'PAN must follow the 10-character PAN format' }); next.panNumber = value; }
  if (businessRegistrationNumber !== undefined) next.businessRegistrationNumber = String(businessRegistrationNumber).slice(0, 80);
  if (legalBusinessName !== undefined) next.legalBusinessName = String(legalBusinessName).slice(0, 120);
  if (tradeName !== undefined) next.tradeName = String(tradeName).slice(0, 120);
  if (gstRegistrationStatus !== undefined && GST_STATUSES.includes(gstRegistrationStatus)) next.gstRegistrationStatus = gstRegistrationStatus;
  if (defaultGstRate !== undefined) {
    const rate = String(defaultGstRate).trim();
    if (rate && (!/^\d{1,3}(?:\.\d{1,2})?$/.test(rate) || Number(rate) > 100)) return res.status(400).json({ error: 'Default GST rate must be between 0 and 100' });
    next.defaultGstRate = rate.slice(0, 10);
  }
  if (msmeUdyamNumber !== undefined) next.msmeUdyamNumber = String(msmeUdyamNumber).slice(0, 80);
  if (shopEstablishmentNumber !== undefined) next.shopEstablishmentNumber = String(shopEstablishmentNumber).slice(0, 80);
  if (invoicePrefix !== undefined) next.invoicePrefix = String(invoicePrefix).slice(0, 20);
  if (startingInvoiceNumber !== undefined) next.startingInvoiceNumber = Math.max(1, Math.floor(Number(startingInvoiceNumber) || 1));
  if (invoiceTitle !== undefined && INVOICE_TITLES.includes(invoiceTitle)) next.invoiceTitle = invoiceTitle;
  if (invoiceFontSize !== undefined && INVOICE_FONT_SIZES.includes(invoiceFontSize)) next.invoiceFontSize = invoiceFontSize;
  if (returnAllowed !== undefined) next.returnAllowed = !!returnAllowed;
  if (returnWindowDays !== undefined) next.returnWindowDays = Math.max(0, Math.floor(Number(returnWindowDays) || 0));
  if (returnConditions !== undefined) next.returnConditions = String(returnConditions).slice(0, 800);
  if (exchangeAllowed !== undefined) next.exchangeAllowed = !!exchangeAllowed;
  if (exchangeWindowDays !== undefined) next.exchangeWindowDays = Math.max(0, Math.floor(Number(exchangeWindowDays) || 0));
  if (exchangeConditions !== undefined) next.exchangeConditions = String(exchangeConditions).slice(0, 800);
  if (termsAndConditions !== undefined) next.termsAndConditions = String(termsAndConditions).slice(0, 1200);
  if (showPoliciesOnInvoice !== undefined) next.showPoliciesOnInvoice = !!showPoliciesOnInvoice;
  if (upiId !== undefined) next.upiId = String(upiId).slice(0, 120);
  if (bankName !== undefined) next.bankName = String(bankName).slice(0, 120);
  if (accountHolderName !== undefined) next.accountHolderName = String(accountHolderName).slice(0, 120);
  if (accountNumber !== undefined) next.accountNumber = String(accountNumber).replace(/\s/g, '').slice(0, 30);
  if (ifscCode !== undefined) next.ifscCode = String(ifscCode).trim().toUpperCase().slice(0, 20);
  if (showPaymentDetailsOnInvoice !== undefined) next.showPaymentDetailsOnInvoice = !!showPaymentDetailsOnInvoice;
  if (website !== undefined) next.website = String(website).slice(0, 200);
  if (instagram !== undefined) next.instagram = String(instagram).slice(0, 200);
  if (facebook !== undefined) next.facebook = String(facebook).slice(0, 200);
  if (googleBusinessLink !== undefined) next.googleBusinessLink = String(googleBusinessLink).slice(0, 300);
  if (showOnlineDetailsOnInvoice !== undefined) next.showOnlineDetailsOnInvoice = !!showOnlineDetailsOnInvoice;
  if (invoiceDisplay !== undefined && invoiceDisplay && typeof invoiceDisplay === 'object') next.invoiceDisplay = Object.assign({}, db.getSettings().invoiceDisplay || {}, Object.fromEntries(Object.entries(invoiceDisplay).map(([k,v]) => [k, !!v])));
  if (anthropicApiKey !== undefined) next.anthropicApiKey = anthropicApiKey ? String(anthropicApiKey).trim() : null;
  db.setSettings(next);
  res.json({ ok: true });
});

router.post('/change-password', requireAdmin, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 4) {
    return res.status(400).json({ error: 'Choose a password with at least 4 characters.' });
  }
  auth.setAdminPassword(newPassword);
  res.json({ ok: true });
});

module.exports = router;
