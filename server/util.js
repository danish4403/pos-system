// Small shared helpers used by more than one route file.

// Mobile numbers everywhere in the system: digits only, capped at 10.
// Anything else typed (spaces, +91, dashes, letters) is stripped rather
// than rejected outright, so pasting a formatted number still works.
function sanitizePhone(v) {
  if (!v) return '';
  return String(v).replace(/\D/g, '').slice(0, 10);
}

module.exports = { sanitizePhone };
