import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Download, Pencil, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { money, date, dateTime } from '../format.js';
import { useLoad, useAction, Loading, Field, Modal, Tabs, useApp, isAdmin, isOffice, Avatar, Empty } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import { LineItemsEditor } from '../components/shared.jsx';

function Company() {
  const { settings, refresh, user } = useApp();
  const [f, setF] = useState(settings);
  const [run, busy] = useAction();
  const can = isAdmin(user);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const F = ({ k, label, type = 'text', full, area, hint }) => <Field label={label} full={full} hint={hint}>{area ? <textarea value={f[k] || ''} onChange={set(k)} disabled={!can} /> : <input type={type} value={f[k] || ''} onChange={set(k)} disabled={!can} />}</Field>;
  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="section-title">Company details (shown on quotes & invoices)</div>
        <div className="form-grid">
          {F({ k: 'company_name', label: 'Company name' })}{F({ k: 'company_email', label: 'Email', type: 'email' })}
          {F({ k: 'company_phone', label: 'Phone' })}{F({ k: 'company_reg_no', label: 'Company / contractor registration no.' })}
          {F({ k: 'company_address', label: 'Address', full: true, area: true })}
          {F({ k: 'vat_no', label: 'VAT / tax number' })}{F({ k: 'public_url', label: 'Public app URL', hint: 'Used in client links in emails, e.g. https://ops.yourcompany.ie' })}
        </div>
      </div>
      <div className="card card-pad">
        <div className="section-title">Money</div>
        <div className="form-grid">
          {F({ k: 'currency', label: 'Currency code', hint: 'e.g. EUR, GBP, USD' })}{F({ k: 'locale', label: 'Locale', hint: 'e.g. en-IE, en-GB, en-US' })}
          {F({ k: 'tax_label', label: 'Tax label' })}{F({ k: 'tax_rate', label: 'Default tax rate (%)', type: 'number' })}
          {F({ k: 'invoice_terms_days', label: 'Invoice payment terms (days)', type: 'number' })}{F({ k: 'quote_valid_days', label: 'Quotes valid for (days)', type: 'number' })}
          {F({ k: 'bank_details', label: 'Bank details (shown on invoices)', full: true, area: true })}
          {F({ k: 'invoice_message', label: 'Default invoice message', full: true, area: true })}
          {F({ k: 'quote_terms', label: 'Default quote terms', full: true, area: true })}
        </div>
      </div>
      <div className="card card-pad">
        <div className="section-title">Numbering</div>
        <div className="form-grid">
          {F({ k: 'next_quote_number', label: 'Next quote number', type: 'number' })}{F({ k: 'next_job_number', label: 'Next job number', type: 'number' })}
          {F({ k: 'next_invoice_number', label: 'Next invoice number', type: 'number' })}
        </div>
      </div>
      {can && <div className="btn-group" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy} onClick={() => run(() => api.put('/settings', f), 'Settings saved').then(refresh).catch(() => {})}>Save settings</button></div>}
    </div>
  );
}

const COLORS = ['#f59e0b', '#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#475569'];
function UserModal({ u, onClose, onSaved }) {
  const { user } = useApp();
  const [f, setF] = useState(u || { name: '', email: '', phone: '', role: 'tech', color: COLORS[Math.floor(Math.random() * COLORS.length)], hourly_cost: 30, licence_no: '', password: '', active: 1 });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={u ? 'Edit team member' : 'Add team member'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={() => run(() => u ? api.put(`/users/${u.id}`, f) : api.post('/users', f), 'Saved').then(onSaved).catch(() => {})}>Save</button></>}>
      <div className="form-grid">
        <Field label="Name"><input value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Email (login)"><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone"><input value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Role"><select value={f.role} onChange={set('role')}>
          <option value="tech">Electrician / Field tech — own schedule, jobs, time & expenses</option>
          <option value="office">Office — clients, quotes, jobs, invoices</option>
          <option value="admin">Admin — everything incl. settings & team</option>
          {user.role === 'owner' && <option value="owner">Owner</option>}
        </select></Field>
        <Field label="Hourly cost (for job costing & payroll)"><input type="number" step="0.01" value={f.hourly_cost} onChange={set('hourly_cost')} /></Field>
        <Field label="Electrical licence / reg. no."><input value={f.licence_no || ''} onChange={set('licence_no')} /></Field>
        <div className="field full"><span>Calendar colour</span><div className="row wrap">{COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setF({ ...f, color: c })} style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: f.color === c ? '3px solid var(--ink)' : '2px solid #fff', boxShadow: '0 0 0 1px var(--border)', cursor: 'pointer' }} />)}</div></div>
        <Field label={u ? 'New password (leave blank to keep)' : 'Password'} full hint="At least 8 characters. Share it with them securely; they can change it under Account."><input type="text" value={f.password || ''} onChange={set('password')} /></Field>
        {u && <label className="check full"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} /> Active (can sign in)</label>}
      </div>
    </Modal>
  );
}

function Team() {
  const { user } = useApp();
  const { data, reload } = useLoad('/users');
  const [edit, setEdit] = useState(null);
  if (!data) return <Loading />;
  return (
    <div className="card">
      <div className="card-head"><h3>Team</h3>{isAdmin(user) && <button className="btn primary sm" onClick={() => setEdit({})}><Plus size={14} /> Add team member</button>}</div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th className="num">Hourly cost</th><th>Status</th></tr></thead>
        <tbody>{data.map((u) => (
          <tr key={u.id} className={isAdmin(user) ? 'clickable' : ''} onClick={() => isAdmin(user) && setEdit(u)}>
            <td><div className="row"><Avatar name={u.name} color={u.color} /><div><b>{u.name}</b>{u.licence_no && <div className="small muted">Reg. {u.licence_no}</div>}</div></div></td>
            <td>{u.email}</td><td style={{ textTransform: 'capitalize' }}>{u.role === 'tech' ? 'Electrician' : u.role}</td><td className="num">{money(u.hourly_cost)}</td>
            <td>{u.active ? <span className="badge green">Active</span> : <span className="badge">Inactive</span>}</td>
          </tr>))}
        </tbody>
      </table></div>
      {edit && <UserModal u={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function Products() {
  const { data, reload } = useLoad('/products?all=1');
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Loading />;
  const save = () => run(() => edit.id ? api.put(`/products/${edit.id}`, edit) : api.post('/products', edit), 'Saved').then(() => { setEdit(null); reload(); }).catch(() => {});
  return (
    <div className="card">
      <div className="card-head"><h3>Products & services</h3><button className="btn primary sm" onClick={() => setEdit({ name: '', description: '', kind: 'service', unit_price: 0, unit_cost: 0, active: 1 })}><Plus size={14} /> Add item</button></div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Name</th><th>Type</th><th className="num">Price</th><th className="num">Cost</th><th className="num">Margin</th><th /></tr></thead>
        <tbody>{data.map((p) => (
          <tr key={p.id} className="clickable" onClick={() => setEdit(p)} style={{ opacity: p.active ? 1 : 0.5 }}>
            <td><b>{p.name}</b><div className="small muted" style={{ maxWidth: 480 }}>{p.description}</div></td><td style={{ textTransform: 'capitalize' }}>{p.kind}</td>
            <td className="num">{money(p.unit_price)}</td><td className="num">{money(p.unit_cost)}</td><td className="num">{p.unit_price ? Math.round(((p.unit_price - p.unit_cost) / p.unit_price) * 100) : 0}%</td><td>{!p.active && <span className="badge">Archived</span>}</td>
          </tr>))}
        </tbody>
      </table></div>
      {edit && (
        <Modal title={edit.id ? 'Edit item' : 'New item'} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
          <div className="form-grid">
            <Field label="Name" full><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="Description" full><textarea value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Field label="Type"><select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}><option value="service">Service</option><option value="material">Material</option><option value="labour">Labour</option></select></Field>
            <Field label="Unit price"><input type="number" step="0.01" value={edit.unit_price} onChange={(e) => setEdit({ ...edit, unit_price: e.target.value })} /></Field>
            <Field label="Unit cost"><input type="number" step="0.01" value={edit.unit_cost} onChange={(e) => setEdit({ ...edit, unit_cost: e.target.value })} /></Field>
            <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} /> Active</label>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Templates() {
  const { data, reload } = useLoad('/quote-templates');
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Loading />;
  const save = () => run(() => { const body = { ...edit, items: edit.items.map(({ key, ...r }) => r) }; return edit.id ? api.put(`/quote-templates/${edit.id}`, body) : api.post('/quote-templates', body); }, 'Template saved').then(() => { setEdit(null); reload(); }).catch(() => {});
  return (
    <div className="card">
      <div className="card-head"><h3>Quote templates</h3><button className="btn primary sm" onClick={() => setEdit({ name: '', title: '', intro: '', items: [] })}><Plus size={14} /> New template</button></div>
      <ul className="list-plain" style={{ padding: '0 20px' }}>
        {data.map((t) => (
          <li key={t.id} className="row"><div style={{ flex: 1 }}><b>{t.name}</b><div className="small muted">{t.items.length} items</div></div>
            <button className="btn sm" onClick={() => setEdit(t)}><Pencil size={13} /> Edit</button>
            <button className="btn sm ghost" aria-label="Delete" onClick={() => confirm('Delete template?') && run(() => api.del(`/quote-templates/${t.id}`)).then(reload)}><Trash2 size={13} /></button></li>
        ))}
        {!data.length && <li className="muted">No templates.</li>}
      </ul>
      {edit && (
        <Modal wide title={edit.id ? 'Edit template' : 'New template'} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save template</button></>}>
          <div className="form-grid">
            <Field label="Template name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Quote title"><input value={edit.title || ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="Introduction" full><textarea rows={4} value={edit.intro || ''} onChange={(e) => setEdit({ ...edit, intro: e.target.value })} /></Field>
          </div>
          <div className="mt"><LineItemsEditor items={edit.items} onChange={(items) => setEdit({ ...edit, items })} allowOptional /></div>
        </Modal>
      )}
    </div>
  );
}

function Account() {
  const { user } = useApp();
  const [f, setF] = useState({ current: '', next: '' });
  const [run, busy] = useAction();
  return (
    <div className="card card-pad" style={{ maxWidth: 520 }}>
      <div className="row mb"><Avatar name={user.name} color={user.color} /><div><b>{user.name}</b><div className="small muted">{user.email} · {user.role}</div></div></div>
      <div className="section-title">Change password</div>
      <div className="stack">
        <Field label="Current password"><input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="New password"><input type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
        <button className="btn primary" disabled={busy} onClick={() => run(() => api.post('/auth/password', f), 'Password updated').then(() => setF({ current: '', next: '' })).catch(() => {})}>Update password</button>
      </div>
    </div>
  );
}

function Data() {
  const { data } = useLoad('/outbox');
  return (
    <div className="stack">
      <div className="card card-pad">
        <h3>Backup & export</h3>
        <p className="muted mt-s mb">Download every record (clients, quotes, jobs, invoices, payments, time, expenses…) as one JSON file. The live database is a single SQLite file in the server's data folder — back that folder up too.</p>
        <a className="btn" href="/api/export"><Download size={15} /> Export all data</a>
      </div>
      <div className="card">
        <div className="card-head"><h3>Email outbox</h3><span className="small muted">Every email sent to clients</span></div>
        {!data ? <Loading /> : data.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
            <tbody>{data.map((m) => <tr key={m.id}><td className="muted">{dateTime(m.created_at)}</td><td>{m.to_email}</td><td>{m.subject}</td><td><span className={`badge ${m.status === 'sent' ? 'green' : m.status === 'failed' ? 'red' : ''}`} title={m.error || ''}>{m.status}</span></td></tr>)}</tbody>
          </table></div>
        ) : <Empty title="No emails yet" />}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { tab = 'company' } = useParams();
  const { user } = useApp();
  const nav = useNavigate();
  const tabs = isOffice(user)
    ? [['company', 'Company'], ['team', 'Team'], ['products', 'Products & services'], ['templates', 'Quote templates'], ['account', 'My account'], ...(isAdmin(user) ? [['data', 'Data & email log']] : [])]
    : [['account', 'My account']];
  const current = tabs.some(([k]) => k === tab) ? tab : tabs[0][0];
  return (
    <div>
      <PageHead title="Settings" />
      <Tabs value={current} onChange={(t) => nav(`/settings/${t}`)} tabs={tabs} />
      {current === 'company' && <Company />}
      {current === 'team' && <Team />}
      {current === 'products' && <Products />}
      {current === 'templates' && <Templates />}
      {current === 'account' && <Account />}
      {current === 'data' && <Data />}
    </div>
  );
}
