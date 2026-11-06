import React, { useState } from 'react';
import { api } from '../api.js';
import { money } from '../format.js';
import { Modal, Field, useAction, useToast, useApp } from './ui.jsx';

/** Minimal CSV parser (quoted fields, commas or semicolons, CRLF). */
export function parseCsv(text) {
  const sep = (text.split(/\r?\n/)[0].match(/;/g) || []).length > (text.split(/\r?\n/)[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
/** Map CSV rows to objects using a { field: [accepted heading spellings] } table. */
export function mapRows(rows, headerMap) {
  const [head = [], ...rest] = rows;
  const cols = head.map((h) => Object.keys(headerMap).find((f) => headerMap[f].includes(norm(h))) || null);
  const records = rest.map((r) => {
    const o = {};
    cols.forEach((c, i) => { if (c && r[i] != null && String(r[i]).trim() && o[c] == null) o[c] = String(r[i]).trim(); });
    return o;
  });
  return { cols, records };
}

const DOC_FIELDS = {
  number: ['number', 'no', 'quotenumber', 'quoteno', 'jobnumber', 'jobno', 'invoicenumber', 'invoiceno', 'reference', 'ref', 'id', 'docnumber'],
  client_name: ['client', 'clientname', 'customer', 'customername', 'name', 'company', 'contact'],
  client_email: ['email', 'clientemail', 'customeremail', 'emailaddress'],
  client_phone: ['phone', 'clientphone', 'mobile', 'telephone'],
  address: ['address', 'street', 'propertyaddress', 'siteaddress', 'serviceaddress'],
  city: ['city', 'town'], postcode: ['postcode', 'eircode', 'zip', 'zipcode'],
  title: ['title', 'subject', 'jobtitle', 'quotetitle', 'description1', 'summary'],
  date: ['date', 'created', 'createddate', 'issuedate', 'issued', 'quotedate', 'jobdate', 'startdate', 'invoicedate'],
  due_date: ['duedate', 'due', 'paymentdue'],
  status: ['status', 'state', 'stage'],
  item: ['item', 'lineitem', 'product', 'service', 'productservice', 'itemname'],
  description: ['description', 'itemdescription', 'details', 'lineitemdescription'],
  quantity: ['quantity', 'qty'],
  unit_price: ['unitprice', 'price', 'rate', 'unitcost'],
  line_total: ['linetotal', 'amount', 'linetotalamount'],
  total: ['total', 'totalamount', 'grandtotal', 'value', 'subtotal'],
  amount_paid: ['amountpaid', 'paid', 'paidamount', 'payments'],
  paid_date: ['paiddate', 'datepaid', 'paymentdate', 'paidon'],
  notes: ['notes', 'note', 'comments', 'instructions'],
};

const KINDS = {
  quotes: { title: 'Import quotes', noun: 'quotes', example: 'Quote number, Client, Email, Title, Date, Status, Item, Quantity, Unit price' },
  jobs: { title: 'Import jobs', noun: 'jobs', example: 'Job number, Client, Email, Title, Date, Status, Item, Quantity, Unit price' },
  invoices: { title: 'Import invoices', noun: 'invoices', example: 'Invoice number, Client, Email, Subject, Date, Due date, Status, Item, Quantity, Unit price, Amount paid' },
};

/** Import old quotes, jobs or invoices from another system's CSV export. */
export function DocImportModal({ kind, onClose, onDone }) {
  const { settings } = useApp();
  const cfg = KINDS[kind];
  const [parsed, setParsed] = useState(null);
  const [inclTax, setInclTax] = useState(false);
  const [run, busy] = useAction();
  const toast = useToast();
  const read = (file) => file && file.text().then((t) => setParsed(mapRows(parseCsv(t), DOC_FIELDS))).catch(() => toast('Could not read that file', 'error'));
  const docs = parsed ? new Set(parsed.records.map((r, i) => r.number || `row-${i}`)).size : 0;
  const matched = parsed ? [...new Set(parsed.cols.filter(Boolean))] : [];
  const missingClient = parsed && !matched.includes('client_name') && !matched.includes('client_email');
  const missingMoney = parsed && !matched.some((m) => ['unit_price', 'line_total', 'total'].includes(m));
  return (
    <Modal wide title={cfg.title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !docs || missingClient} onClick={() => run(() => api.post(`/import/${kind}`, { rows: parsed.records, prices_include_tax: inclTax })).then((r) => {
        toast(`Imported ${r.created} ${cfg.noun}${r.clients ? ` · ${r.clients} new clients created` : ''}${r.skipped ? ` · ${r.skipped} skipped (no client)` : ''}`); onDone();
      }).catch(() => {})}>Import {docs || ''} {cfg.noun}</button></>}>
      <p className="muted mb">Bring in your history from another system. Export a CSV from it, then upload it here. The first row must be column headings, for example: <b>{cfg.example}</b>. Rows with the same number become one document with several line items. Clients are matched by email or name; new ones are created.</p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => read(e.target.files[0])} />
      <label className="check small mt-s"><input type="checkbox" checked={inclTax} onChange={(e) => setInclTax(e.target.checked)} /> Prices in the file already include {settings.tax_label || 'tax'} (otherwise {settings.tax_rate}% is added)</label>
      {parsed && (
        <div className="mt">
          <div className={`notice small ${missingClient ? 'red' : 'blue'}`}>
            Found <b>{parsed.records.length}</b> rows → <b>{docs}</b> {cfg.noun}. Matched columns: {matched.length ? matched.map((m) => m.replace('_', ' ')).join(', ') : 'none'}.
            {missingClient && ' Add a Client or Email column so each document can be linked to a client.'}
            {!missingClient && missingMoney && ' No price or total column found, so amounts will be zero.'}
          </div>
          <div className="table-wrap mt-s"><table className="table">
            <thead><tr><th>#</th><th>Client</th><th>Title</th><th>Date</th><th>Status</th><th>Item</th><th className="num">Amount</th></tr></thead>
            <tbody>{parsed.records.slice(0, 6).map((r, i) => (
              <tr key={i}><td>{r.number || '—'}</td><td>{r.client_name || r.client_email || <span className="overdue">missing</span>}</td><td>{r.title || ''}</td><td>{r.date || ''}</td><td>{r.status || ''}</td><td>{r.item || ''}</td>
                <td className="num">{r.unit_price ? money(Number(String(r.unit_price).replace(/[^0-9.-]/g, '')) * (Number(r.quantity) || 1)) : r.line_total || r.total || ''}</td></tr>
            ))}</tbody>
          </table></div>
          {parsed.records.length > 6 && <div className="small muted mt-s">…and {parsed.records.length - 6} more rows</div>}
        </div>
      )}
    </Modal>
  );
}
