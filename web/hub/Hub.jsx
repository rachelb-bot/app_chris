import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Printer } from 'lucide-react';
import { api } from '../api.js';
import { money, date, configureFormat } from '../format.js';
import { Loading, Field, Status, useAction } from '../components/ui.jsx';
import { BrandMark } from '../components/Layout.jsx';

function useHub(url) {
  const [state, setState] = useState({ data: null, error: null });
  const load = () => api.get(url).then((data) => { configureFormat(data.company); setState({ data, error: null }); }).catch((error) => setState({ data: null, error }));
  useEffect(() => { load(); }, [url]);
  return { ...state, reload: load };
}

function HubShell({ company, children }) {
  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)' }}>
      <div className="hub">
        <div className="hub-top">
          <div className="row"><BrandMark /><div><div className="strong" style={{ fontSize: 17 }}>{company?.name}</div><div className="small muted">{[company?.phone, company?.email].filter(Boolean).join(' · ')}</div></div></div>
          <button className="btn no-print" onClick={() => window.print()}><Printer size={15} /> Print / Save PDF</button>
        </div>
        {children}
        <p className="small faint mt" style={{ textAlign: 'center' }}>{[company?.address, company?.reg_no && `Reg. ${company.reg_no}`, company?.vat_no && `${company.tax_label || 'VAT'} ${company.vat_no}`].filter(Boolean).join(' · ')}</p>
      </div>
    </div>
  );
}

function Lines({ items, selectable, selected, onToggle }) {
  return (
    <table className="table">
      <thead><tr><th>Product / Service</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Total</th></tr></thead>
      <tbody>
        {items.map((it) => it.is_text ? <tr key={it.id}><td colSpan={4} className="pre strong">{it.name}</td></tr> : (
          <tr key={it.id} style={{ opacity: it.optional && !(selectable ? selected.has(it.id) : it.selected) ? 0.6 : 1 }}>
            <td>
              <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                {selectable && !!it.optional && <input type="checkbox" checked={selected.has(it.id)} onChange={() => onToggle(it.id)} style={{ width: 17, height: 17, marginTop: 2, accentColor: 'var(--ink)' }} aria-label={`Include ${it.name}`} />}
                <div><div className="strong">{it.name}{!!it.optional && <span className="badge" style={{ marginLeft: 6 }}>Optional</span>}</div>{it.description && <div className="small muted pre">{it.description}</div>}</div>
              </div>
            </td>
            <td className="num">{it.quantity}</td><td className="num">{money(it.unit_price)}</td><td className="num strong">{money(it.quantity * it.unit_price)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function totalsFor(items, sel, discount, tax_rate) {
  let subtotal = 0;
  for (const it of items) { if (it.is_text) continue; if (it.optional && !sel.has(it.id)) continue; subtotal += it.quantity * it.unit_price; }
  const d = Math.min(discount || 0, subtotal);
  const tax = ((subtotal - d) * (tax_rate || 0)) / 100;
  return { subtotal, discount: d, tax, total: subtotal - d + tax };
}

export function QuoteHub() {
  const { token } = useParams();
  const { data, error, reload } = useHub(`/hub/quote/${token}`);
  const [sel, setSel] = useState(new Set());
  const [sig, setSig] = useState('');
  const [changes, setChanges] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setSel(new Set(data.items.filter((i) => !i.optional || i.selected).map((i) => i.id))); }, [data]);
  if (error) return <div className="hub"><div className="notice red">This quote link is invalid or has expired. Please contact us for a new link.</div></div>;
  if (!data) return <Loading />;
  const { quote: q, company, client } = data;
  const canAct = ['sent', 'changes_requested'].includes(q.status);
  const t = totalsFor(data.items, sel, q.discount, q.tax_rate);
  const toggle = (id) => { if (!canAct) return; const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s); };
  return (
    <HubShell company={company}>
      {q.status === 'approved' || q.status === 'converted' ? <div className="notice green mb"><CheckCircle2 size={16} style={{ verticalAlign: -3 }} /> Approved{q.client_signature ? ` by ${q.client_signature}` : ''}{q.approved_at ? ` on ${date(q.approved_at)}` : ''}. Thank you — we'll be in touch to schedule the work.</div> : null}
      {q.status === 'changes_requested' && <div className="notice mb">You've requested changes. We'll send an updated quote shortly.</div>}
      <div className="card">
        <div className="doc-head">
          <div><div className="section-title">Quote for</div><div className="strong">{client.name}</div><div className="small muted pre">{[client.address, client.email, client.phone].filter(Boolean).join('\n')}</div></div>
          <div><h2>{q.title}</h2><dl className="doc-meta mt-s"><dt>Quote #</dt><dd>{q.number}</dd><dt>Date</dt><dd>{date(q.created_at)}</dd>{q.valid_until && <><dt>Valid until</dt><dd>{date(q.valid_until)}</dd></>}</dl></div>
        </div>
        {q.intro && <div className="card-pad pre" style={{ borderBottom: '1px solid var(--border)' }}>{q.intro}</div>}
        <div className="table-wrap"><Lines items={data.items} selectable={canAct} selected={sel} onToggle={toggle} /></div>
        <div className="card-pad">
          <div className="totals">
            <div className="line"><span className="muted">Subtotal</span><b>{money(t.subtotal)}</b></div>
            {t.discount > 0 && <div className="line"><span className="muted">Discount</span><span>−{money(t.discount)}</span></div>}
            <div className="line"><span className="muted">{company.tax_label || 'Tax'} ({q.tax_rate}%)</span><span>{money(t.tax)}</span></div>
            <div className="line grand"><span>Total</span><span>{money(t.total)}</span></div>
            {q.deposit > 0 && <div className="line"><span className="muted">Deposit required</span><b>{money(q.deposit)}</b></div>}
          </div>
        </div>
        {(q.client_message || q.terms) && <div className="card-pad small muted pre" style={{ borderTop: '1px solid var(--border)' }}>{[q.client_message, q.terms].filter(Boolean).join('\n\n')}</div>}
      </div>
      {canAct && (
        <div className="card card-pad mt no-print">
          <h3>Approve this quote</h3>
          {data.items.some((i) => i.optional) && <p className="small muted mt-s">Tick any optional items you'd like included — the total updates automatically.</p>}
          <div className="row wrap mt" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 220 }}><Field label="Type your full name to approve"><input value={sig} onChange={(e) => setSig(e.target.value)} /></Field></div>
            <button className="btn accent" disabled={busy || !sig.trim()} onClick={() => run(() => api.post(`/hub/quote/${token}/approve`, { signature: sig, selected: [...sel] }), 'Quote approved — thank you!').then(reload).catch(() => {})}>Approve quote · {money(t.total)}</button>
            <button className="btn" onClick={() => setChanges('')}>Request changes</button>
          </div>
          {changes !== null && (
            <div className="mt">
              <Field label="What would you like changed?"><textarea value={changes} onChange={(e) => setChanges(e.target.value)} /></Field>
              <div className="row mt-s"><span className="spacer" /><button className="btn" onClick={() => setChanges(null)}>Cancel</button><button className="btn primary" disabled={busy || !changes.trim()} onClick={() => run(() => api.post(`/hub/quote/${token}/changes`, { message: changes }), 'Sent — we\'ll be in touch').then(() => { setChanges(null); reload(); }).catch(() => {})}>Send request</button></div>
            </div>
          )}
        </div>
      )}
    </HubShell>
  );
}

export function InvoiceHub() {
  const { token } = useParams();
  const { data, error } = useHub(`/hub/invoice/${token}`);
  if (error) return <div className="hub"><div className="notice red">This invoice link is invalid. Please contact us.</div></div>;
  if (!data) return <Loading />;
  const { invoice: inv, company, client, totals } = data;
  const sel = new Set(data.items.map((i) => i.id));
  return (
    <HubShell company={company}>
      {totals.balance <= 0 ? <div className="notice green mb">Paid in full — thank you!</div> : inv.status === 'overdue' ? <div className="notice red mb">This invoice is overdue. Balance due: <b>{money(totals.balance)}</b></div> : null}
      <div className="card">
        <div className="doc-head">
          <div><div className="section-title">Bill to</div><div className="strong">{client.name}</div><div className="small muted pre">{[client.address, client.email, client.phone].filter(Boolean).join('\n')}</div></div>
          <div><h2>Invoice #{inv.number}</h2><div className="mt-s"><Status s={inv.status} /></div><dl className="doc-meta mt-s"><dt>Subject</dt><dd>{inv.subject}</dd><dt>Issued</dt><dd>{date(inv.issue_date)}</dd><dt>Due</dt><dd>{date(inv.due_date)}</dd></dl></div>
        </div>
        <div className="table-wrap"><Lines items={data.items} selected={sel} /></div>
        <div className="card-pad">
          <div className="totals">
            <div className="line"><span className="muted">Subtotal</span><b>{money(totals.subtotal)}</b></div>
            {totals.discount > 0 && <div className="line"><span className="muted">Discount</span><span>−{money(totals.discount)}</span></div>}
            <div className="line"><span className="muted">{company.tax_label || 'Tax'} ({inv.tax_rate}%)</span><span>{money(totals.tax)}</span></div>
            <div className="line"><span className="muted">Total</span><b>{money(totals.total)}</b></div>
            {data.payments.map((p, i) => <div className="line small" key={i}><span className="muted">Paid {date(p.paid_on)}</span><span>−{money(p.amount)}</span></div>)}
            <div className="line grand"><span>Balance due</span><span>{money(totals.balance)}</span></div>
          </div>
        </div>
        {(inv.client_message || company.bank_details) && <div className="card-pad small pre" style={{ borderTop: '1px solid var(--border)' }}>{[inv.client_message, company.bank_details && `How to pay:\n${company.bank_details}\nReference: Invoice ${inv.number}`].filter(Boolean).join('\n\n')}</div>}
      </div>
    </HubShell>
  );
}

export function BookingHub() {
  const { data } = useHub('/hub/booking');
  const [f, setF] = useState({ first_name: '', last_name: '', email: '', phone: '', street: '', city: '', postcode: '', service: '', details: '', preferred: '', website: '' });
  const [done, setDone] = useState(false);
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (!data) return <Loading />;
  return (
    <HubShell company={data.company}>
      <div className="card card-pad">
        {done ? (
          <div className="empty"><div className="icon"><CheckCircle2 size={24} /></div><h3>Thanks — request received</h3><p>We'll be in touch shortly to arrange a time.</p></div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); run(() => api.post('/hub/booking', f)).then(() => setDone(true)).catch(() => {}); }}>
            <h2>Request electrical work</h2>
            <p className="muted mt-s mb">Tell us what you need and we'll get back to you with a time or a quote.</p>
            <div className="form-grid">
              <Field label="First name *"><input required value={f.first_name} onChange={set('first_name')} /></Field>
              <Field label="Last name"><input value={f.last_name} onChange={set('last_name')} /></Field>
              <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
              <Field label="Phone"><input type="tel" value={f.phone} onChange={set('phone')} /></Field>
              <Field label="Street address" full><input value={f.street} onChange={set('street')} /></Field>
              <Field label="Town / City"><input value={f.city} onChange={set('city')} /></Field>
              <Field label="Postcode / Eircode"><input value={f.postcode} onChange={set('postcode')} /></Field>
              <Field label="What do you need?" full><select value={f.service} onChange={set('service')}>
                <option value="">Choose a service…</option>{['Fault finding / repair', 'Consumer unit / fuse board upgrade', 'EV charger installation', 'New sockets or lighting', 'Rewire', 'Inspection & certificate', 'Commercial work', 'Other'].map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Details *" full><textarea required rows={4} value={f.details} onChange={set('details')} placeholder="Describe the job, any urgency, access notes…" /></Field>
              <Field label="Preferred days / times" full><input value={f.preferred} onChange={set('preferred')} /></Field>
              <input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} style={{ position: 'absolute', left: -9999 }} aria-hidden="true" />
            </div>
            <button className="btn accent mt" disabled={busy}>Send request</button>
          </form>
        )}
      </div>
    </HubShell>
  );
}
