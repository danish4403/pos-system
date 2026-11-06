const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const router = express.Router();
const cell = value => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
const csv = (headers, rows) => [headers.join(','), ...rows.map(r => headers.map(h => cell(r[h])).join(','))].join('\r\n');
const localDate = timestamp => { const d = new Date(timestamp); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

router.get('/:kind', requireAdmin, (req, res) => {
  const kind = req.params.kind;
  let headers, rows;
  if (kind === 'inventory') { headers=['id','name','code','category','supplier','quantity','price','costPrice','frequent']; rows=db.getInventory(); }
  else if (kind === 'customers') { headers=['id','name','phone','email','address','createdAt']; rows=db.getCustomers(); }
  else if (kind === 'sales') {
    headers=['saleId','date','time','customerName','item','quantity','returnedQuantity','amount','refundAmount','netSale'];
    rows=db.getSales().flatMap(s => (s.items||[]).map(i => {
      const returnedQuantity = (s.returns || []).reduce((sum, r) => sum + (r.items || []).filter(x => x.id === i.id).reduce((n, x) => n + Number(x.qty || 0), 0), 0);
      const grossAmount = Number(i.lineTotal ?? (Number(i.price || 0) * Number(i.qty || 0))) || 0;
      const unitAmount = Number(i.qty || 0) > 0 ? grossAmount / Number(i.qty) : 0;
      const refundAmount = Math.min(grossAmount, unitAmount * returnedQuantity);
      return {
        saleId:s.id,
        date:localDate(s.timestamp),
        time:new Date(s.timestamp).toLocaleTimeString(),
        customerName:s.customerName,
        item:i.name,
        quantity:Math.max(0, Number(i.qty || 0) - returnedQuantity),
        returnedQuantity,
        amount:Math.round(grossAmount * 100) / 100,
        refundAmount:Math.round(refundAmount * 100) / 100,
        netSale:Math.round(Math.max(0, grossAmount - refundAmount) * 100) / 100,
      };
    }));
  }
  else return res.status(404).json({ error: 'Unknown export type' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${kind}-${new Date().toISOString().slice(0,10)}.csv"`); res.send(csv(headers, rows));
});
module.exports = router;
