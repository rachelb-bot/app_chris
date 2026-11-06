import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, GripVertical, Search, FileText, Paperclip, X, Type } from 'lucide-react';
import { api, qs } from '../api.js';
import { money, ago, date } from '../format.js';
import { useLoad, useAction, Field, Modal, useDebounced, useApp, askConfirm } from './ui.jsx';

// ===================== totals =====================
export function computeTotals(items, { discount = 0, tax_rate = 0 } = {}) {
  let subtotal = 0, cost = 0;
  for (const it of items) {
    if (it.is_text || (it.optional && !it.selected)) continue;
    subtotal += (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
    cost += (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0);
  }
  const disc = Math.min(Number(discount) || 0, subtotal);
  const tax = ((subtotal - disc) * (Number(tax_rate) || 0)) / 100;
  return { subtotal, discount: disc, tax, total: subtotal - disc + tax, cost };
}

// ===================== line items editor =====================
const blank = () => ({ key: Math.random(), name: '', description: '', quantity: 1, unit_price: 0, unit_cost: 0, optional: 0, selected: 1 });

export function LineItemsEditor({ items, onChange, allowOptional, showCost = true }) {
  const { data: products } = useLoad('/products');
  const [pickerFor, setPickerFor] = useState(null);
  const rows = items.map((it) => (it.key ? it : { ...it, key: it.id || Math.random() }));
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i) => onChange(rows.filter((_, j) => j !== i));
  const move = (from, to) => { if (to < 0 || to >= rows.length) return; const c = [...rows]; const [x] = c.splice(from, 1); c.splice(to, 0, x); onChange(c); };
  const drag = useRef(null);

  return (
    <div>
      <div className="table-wrap">
        <table className="li-table">
          <thead><tr><th style={{ width: 18 }} /><th>Product / Service</th><th style={{ width: 80 }} className="right">Qty</th><th style={{ width: 110 }} className="right">Unit price</th>{showCost && <th style={{ width: 100 }} className="right hide-sm">Unit cost</th>}<th style={{ width: 110 }} className="right">Total</th><th style={{ width: 36 }} /></tr></thead>
          <tbody>
            {rows.map((it, i) => (
              <tr key={it.key} className="li-row" draggable onDragStart={() => (drag.current = i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { move(drag.current, i); drag.current = null; }}>
                <td style={{ paddingTop: 12, cursor: 'grab' }} className="faint"><GripVertical size={14} /></td>
                <td>
                  {it.is_text ? (
                    <textarea placeholder="Text / heading shown on the document" value={it.name} onChange={(e) => set(i, { name: e.target.value })} style={{ marginTop: 0 }} />
                  ) : (<>
                    <div className="row" style={{ gap: 6 }}>
                      <input placeholder="Name" value={it.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Item name" />
                      <button type="button" className="btn sm icon" title="Choose from catalogue" onClick={() => setPickerFor(i)}><Search size={14} /></button>
                    </div>
                    <textarea placeholder="Description" value={it.description || ''} onChange={(e) => set(i, { description: e.target.value })} />
                    {allowOptional && (
                      <div className="row mt-s" style={{ gap: 14 }}>
                        <label className="check small"><input type="checkbox" checked={!!it.optional} onChange={(e) => set(i, { optional: e.target.checked ? 1 : 0, selected: 1 })} /> Mark as optional</label>
                        {!!it.optional && <label className="check small"><input type="checkbox" checked={!!it.selected} onChange={(e) => set(i, { selected: e.target.checked ? 1 : 0 })} /> Included in total</label>}
                      </div>
                    )}
                  </>)}
                </td>
                {it.is_text ? <td colSpan={showCost ? 4 : 3} /> : (<>
                  <td className="num"><input type="number" step="any" value={it.quantity} onChange={(e) => set(i, { quantity: e.target.value })} aria-label="Quantity" /></td>
                  <td className="num"><input type="number" step="0.01" value={it.unit_price} onChange={(e) => set(i, { unit_price: e.target.value })} aria-label="Unit price" /></td>
                  {showCost && <td className="num hide-sm"><input type="number" step="0.01" value={it.unit_cost} onChange={(e) => set(i, { unit_cost: e.target.value })} aria-label="Unit cost" /></td>}
                  <td className="num" style={{ paddingTop: 13, fontWeight: 600, opacity: it.optional && !it.selected ? 0.5 : 1 }}>{money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))}</td>
                </>)}
                <td><button type="button" className="btn ghost icon" onClick={() => remove(i)} aria-label="Remove line"><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="btn-group mt-s">
        <button type="button" className="btn primary sm" onClick={() => onChange([...rows, blank()])}><Plus size={15} /> Add line item</button>
        <button type="button" className="btn sm" onClick={() => setPickerFor('new')}><Search size={14} /> From catalogue</button>
        <button type="button" className="btn sm" onClick={() => onChange([...rows, { ...blank(), is_text: 1 }])}><Type size={14} /> Add text</button>
      </div>
      {pickerFor !== null && (
        <ProductPicker products={products || []} onClose={() => setPickerFor(null)} onPick={(p) => {
          const patch = { product_id: p.id, name: p.name, description: p.description, unit_price: p.unit_price, unit_cost: p.unit_cost };
          if (pickerFor === 'new') onChange([...rows, { ...blank(), ...patch }]); else set(pickerFor, patch);
          setPickerFor(null);
        }} />
      )}
    </div>
  );
}

function ProductPicker({ products, onPick, onClose }) {
  const [q, setQ] = useState('');
  const list = products.filter((p) => !q || (p.name + ' ' + (p.description || '')).toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="Products & services" onClose={onClose}>
      <input className="input" autoFocus placeholder="Search catalogue…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="list-plain mt-s" style={{ maxHeight: 400, overflow: 'auto' }}>
        {list.map((p) => (
          <li key={p.id}>
            <button type="button" className="row" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', padding: 0 }} onClick={() => onPick(p)}>
              <div style={{ flex: 1, minWidth: 0 }}><div className="strong">{p.name}</div><div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.description}</div></div>
              <div className="strong">{money(p.unit_price)}</div>
            </button>
          </li>
        ))}
        {!list.length && <li className="muted">No matches. Add products in Settings → Products & services.</li>}
      </ul>
    </Modal>
  );
}

export function TotalsEditor({ items, discount, tax_rate, onChange, deposit, showDeposit, readOnly }) {
  const { settings } = useApp();
  const t = computeTotals(items, { discount, tax_rate });
  return (
    <div className="totals">
      <div className="line"><span className="muted">Subtotal</span><b>{money(t.subtotal)}</b></div>
      <div className="line"><span className="muted">Discount</span>{readOnly ? <span>−{money(t.discount)}</span> : <input type="number" step="0.01" value={discount} onChange={(e) => onChange({ discount: e.target.value })} aria-label="Discount" />}</div>
      <div className="line"><span className="muted">{settings.tax_label || 'Tax'} (%)</span>{readOnly ? <span>{tax_rate}%</span> : <input type="number" step="0.01" value={tax_rate} onChange={(e) => onChange({ tax_rate: e.target.value })} aria-label="Tax rate" />}</div>
      <div className="line"><span className="muted">{settings.tax_label || 'Tax'}</span><span>{money(t.tax)}</span></div>
      <div className="line grand"><span>Total</span><span>{money(t.total)}</span></div>
      {showDeposit && <div className="line"><span className="muted">Required deposit</span>{readOnly ? <span>{money(deposit)}</span> : <input type="number" step="0.01" value={deposit} onChange={(e) => onChange({ deposit: e.target.value })} aria-label="Deposit" />}</div>}
      {t.cost > 0 && <div className="line small"><span className="faint">Est. cost / margin</span><span className="faint">{money(t.cost)} · {t.subtotal ? Math.round(((t.subtotal - t.cost) / t.subtotal) * 100) : 0}%</span></div>}
    </div>
  );
}

// ===================== client picker =====================
export function ClientPicker({ value, onChange, allowNew = true }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data: list } = useLoad(`/clients${qs({ q: dq, status: 'leads_active' })}`, []);
  const { data: client } = useLoad(value ? `/clients/${value}` : null);
  const [creating, setCreating] = useState(false);

  if (value && client) {
    return (
      <div className="card card-pad" style={{ boxShadow: 'none' }}>
        <div className="row"><div style={{ flex: 1 }}><div className="strong">{client.name}</div><div className="small muted">{[client.email, client.phone].filter(Boolean).join(' · ')}</div></div>
          <button type="button" className="btn sm" onClick={() => onChange(null, null)}>Change</button></div>
      </div>
    );
  }
  return (
    <div>
      <div className="row">
        <input className="input" placeholder="Search clients by name, email, address…" value={q} onChange={(e) => setQ(e.target.value)} />
        {allowNew && <button type="button" className="btn" onClick={() => setCreating(true)}><Plus size={15} /> New client</button>}
      </div>
      <ul className="list-plain mt-s" style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '0 12px' }}>
        {(list || []).slice(0, 30).map((c) => (
          <li key={c.id} style={{ cursor: 'pointer' }} onClick={() => onChange(c.id, c)}>
            <div className="strong">{c.name}</div><div className="small muted">{c.address || c.email || c.phone || '—'}</div>
          </li>
        ))}
        {list && !list.length && <li className="muted">No clients found.</li>}
      </ul>
      {creating && <ClientFormModal onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); onChange(id); }} />}
    </div>
  );
}

export function PropertySelect({ client, value, onChange }) {
  if (!client?.properties?.length) return null;
  return (
    <Field label="Property">
      <select value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        {client.properties.map((p) => <option key={p.id} value={p.id}>{p.address || 'Unnamed property'}</option>)}
      </select>
    </Field>
  );
}

const LEAD_SOURCES = ['Google', 'Referral', 'Facebook', 'Instagram', 'Website', 'Online booking', 'Flyer', 'Van signage', 'Repeat client', 'Other'];
export function ClientFormModal({ client, onClose, onSaved }) {
  const [f, setF] = useState(() => client ? { ...client, tags: (client.tags || []).join(', ') } : { first_name: '', last_name: '', company_name: '', email: '', phone: '', client_type: 'residential', lead_source: '', tags: '', notes: '', property: { street: '', city: '', region: '', postcode: '', country: '' } });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setP = (k) => (e) => setF({ ...f, property: { ...f.property, [k]: e.target.value } });
  const save = () => run(async () => {
    const body = { ...f, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean) };
    if (client) { await api.put(`/clients/${client.id}`, body); return client.id; }
    return (await api.post('/clients', body)).id;
  }, client ? 'Client updated' : 'Client created').then(onSaved).catch(() => {});
  return (
    <Modal wide title={client ? 'Edit client' : 'New client'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save client</button></>}>
      <div className="form-grid">
        <Field label="First name"><input value={f.first_name || ''} onChange={set('first_name')} autoFocus /></Field>
        <Field label="Last name"><input value={f.last_name || ''} onChange={set('last_name')} /></Field>
        <Field label="Company name" full><input value={f.company_name || ''} onChange={set('company_name')} /></Field>
        <Field label="Email"><input type="email" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Phone"><input type="tel" value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Client type"><select value={f.client_type} onChange={set('client_type')}><option value="residential">Residential</option><option value="commercial">Commercial</option></select></Field>
        <Field label="Lead source"><select value={f.lead_source || ''} onChange={set('lead_source')}><option value="">—</option>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select></Field>
        {client && <Field label="Status"><select value={f.status} onChange={set('status')}><option value="lead">Lead</option><option value="active">Active</option><option value="archived">Archived</option></select></Field>}
        <Field label="Tags (comma separated)" full={!client}><input value={f.tags} onChange={set('tags')} placeholder="e.g. landlord, EV, priority" /></Field>
        {!client && (<>
          <div className="full section-title" style={{ marginTop: 8 }}>Property address</div>
          <Field label="Street" full><input value={f.property.street} onChange={setP('street')} /></Field>
          <Field label="City / Town"><input value={f.property.city} onChange={setP('city')} /></Field>
          <Field label="County / Region"><input value={f.property.region} onChange={setP('region')} /></Field>
          <Field label="Postcode / Eircode"><input value={f.property.postcode} onChange={setP('postcode')} /></Field>
          <Field label="Country"><input value={f.property.country} onChange={setP('country')} /></Field>
        </>)}
        <Field label="Notes" full><textarea value={f.notes || ''} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

// ===================== notes =====================
export function Notes({ type, id }) {
  const { data, reload } = useLoad(`/notes/${type}/${id}`);
  const [body, setBody] = useState('');
  const [run, busy] = useAction();
  const add = () => run(() => api.post(`/notes/${type}/${id}`, { body })).then(() => { setBody(''); reload(); }).catch(() => {});
  return (
    <div className="card">
      <div className="card-head"><h3>Internal notes</h3></div>
      <div className="card-pad">
        <textarea className="input" rows={3} placeholder="Leave an internal note for yourself or a team member" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="row mt-s"><span className="spacer" /><button className="btn sm primary" disabled={busy || !body.trim()} onClick={add}>Add note</button></div>
        <ul className="list-plain">
          {(data || []).map((n) => (
            <li key={n.id}>
              <div className="row small"><b>{n.user_name || 'Client hub'}</b><span className="faint">{ago(n.created_at)}</span><span className="spacer" />
                <button className="btn ghost icon sm" aria-label="Delete note" onClick={() => run(() => api.del(`/notes/${n.id}`)).then(reload).catch(() => {})}><Trash2 size={13} /></button></div>
              <div className="pre mt-s">{n.body}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ===================== attachments =====================
export function Attachments({ type, id, title = 'Files & photos' }) {
  const { data, reload } = useLoad(`/attachments/${type}/${id}`);
  const [over, setOver] = useState(false);
  const [run] = useAction();
  const input = useRef();
  const upload = (files) => files.length && run(() => api.upload(`/attachments/${type}/${id}`, files), 'Uploaded').then(reload).catch(() => {});
  return (
    <div className="card">
      <div className="card-head"><h3>{title}</h3></div>
      <div className="card-pad">
        <div className={`dropzone${over ? ' over' : ''}`} onClick={() => input.current.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); upload([...e.dataTransfer.files]); }}>
          <Paperclip size={16} /> Drop files here or <span className="link">browse</span><div className="small faint">Photos, PDFs, certificates — up to 50MB each</div>
          <input ref={input} type="file" multiple hidden onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} />
        </div>
        {!!data?.length && (
          <div className="files">
            {data.map((a) => (
              <div className="file" key={a.id}>
                <a href={`/api/files/${a.id}`} target="_blank" rel="noreferrer">{a.mime?.startsWith('image/') ? <img src={`/api/files/${a.id}`} alt={a.filename} /> : <div className="ph"><FileText size={28} /></div>}</a>
                <div className="nm" title={a.filename}>{a.filename}</div>
                <button className="x" aria-label="Delete file" onClick={() => askConfirm(`Delete ${a.filename}?`).then((ok) => ok && run(() => api.del(`/attachments/${a.id}`)).then(reload).catch(() => {}))}><X size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ===================== activity =====================
export function Activity({ clientId, limit = 15 }) {
  const { data } = useLoad(`/activity${qs({ client_id: clientId, limit })}`);
  if (!data) return null;
  return (
    <ul className="list-plain feed">
      {data.map((a) => <li key={a.id}><span className="dot" /><div><div>{a.summary}</div><div className="small faint">{a.user_name || 'Client'} · {ago(a.created_at)}</div></div></li>)}
      {!data.length && <li className="muted">No activity yet.</li>}
    </ul>
  );
}

// ===================== charts =====================
export function BarChart({ data, label = (d) => d.label, value = (d) => d.value, format = money, highlightLast }) {
  const max = Math.max(1, ...data.map(value));
  return (
    <div className="bars" role="img" aria-label="Bar chart">
      {data.map((d, i) => (
        <div className="b" key={i}>
          <div className={`bar${highlightLast && i === data.length - 1 ? ' hl' : ''}`} data-tip={format(value(d))} style={{ height: `${(value(d) / max) * 85}%` }} />
          <div className="lbl">{label(d)}</div>
        </div>
      ))}
    </div>
  );
}
export function HBars({ data, format = (v) => v }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return <div>{data.map((d) => <div className="hbar" key={d.label}><span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span><div className="track"><div className="fill" style={{ width: `${(d.value / max) * 100}%` }} /></div><b className="right">{format(d.value)}</b></div>)}</div>;
}

/** Which columns the client sees on a quote or invoice. */
export function ClientViewOptions({ value, onChange }) {
  const opt = (k, label) => (
    <label className="check small"><input type="checkbox" checked={value[k] !== 0 && value[k] !== false} onChange={(e) => onChange({ [k]: e.target.checked ? 1 : 0 })} /> {label}</label>
  );
  return (
    <div className="field full"><span>Client view — what the client sees</span>
      <div className="row wrap" style={{ gap: 16 }}>{opt('show_quantities', 'Quantities')}{opt('show_unit_prices', 'Unit prices')}{opt('show_line_totals', 'Line totals')}</div>
    </div>
  );
}

export function DocLines({ items, showOptional = true }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Product / Service</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Total</th></tr></thead>
        <tbody>
          {items.map((it) => it.is_text ? (
            <tr key={it.id}><td colSpan={4} className="pre strong">{it.name}</td></tr>
          ) : (
            <tr key={it.id} style={{ opacity: it.optional && !it.selected ? 0.55 : 1 }}>
              <td><div className="strong">{it.name} {showOptional && !!it.optional && <span className="badge" style={{ marginLeft: 6 }}>{it.selected ? 'Optional · included' : 'Optional'}</span>}</div>{it.description && <div className="small muted pre">{it.description}</div>}</td>
              <td className="num">{it.quantity}</td><td className="num">{money(it.unit_price)}</td><td className="num strong">{money(it.quantity * it.unit_price)}</td>
            </tr>
          ))}
          {!items.length && <tr><td colSpan={4} className="muted">No line items.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function useClient(id) { return useLoad(id ? `/clients/${id}` : null); }
export { date };
