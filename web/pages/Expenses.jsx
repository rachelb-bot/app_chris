import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Wallet, Plus, Paperclip } from 'lucide-react';
import { api, qs } from '../api.js';
import { money, date, ymd } from '../format.js';
import { useLoad, useAction, Loading, Empty, Field, Modal, useApp, isOffice } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Attachments } from '../components/shared.jsx';

const CATS = ['Materials', 'Tools & equipment', 'Fuel & travel', 'Vehicle', 'Subcontractor', 'Permits & certification', 'Phone & software', 'Insurance', 'Other'];

function ExpenseModal({ expense, onClose, onSaved }) {
  const { user } = useApp();
  const office = isOffice(user);
  const { data: jobs } = useLoad('/jobs?status=all');
  const { data: team } = useLoad(office ? '/users' : null);
  const [f, setF] = useState(expense || { title: '', description: '', category: 'Materials', amount: '', date: ymd(), job_id: '', user_id: user.id, reimbursable: false, reimbursed: false, supplier: '' });
  const [files, setFiles] = useState([]);
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = () => run(async () => {
    const body = { ...f, job_id: f.job_id || null };
    const id = expense ? (await api.put(`/expenses/${expense.id}`, body), expense.id) : (await api.post('/expenses', body)).id;
    if (files.length) await api.upload(`/attachments/expense/${id}`, files);
  }, 'Expense saved').then(onSaved).catch(() => {});
  return (
    <Modal wide title={expense ? 'Edit expense' : 'Add expense'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save expense</button></>}>
      <div className="form-grid">
        <Field label="Item name" full><input value={f.title} onChange={set('title')} autoFocus placeholder="e.g. 50m 2.5mm T&E cable" /></Field>
        <Field label="Amount (incl. tax)"><input type="number" step="0.01" value={f.amount} onChange={set('amount')} /></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Category"><select value={f.category || ''} onChange={set('category')}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Supplier"><input value={f.supplier || ''} onChange={set('supplier')} /></Field>
        <Field label="Link to job (for job costing)" full><select value={f.job_id || ''} onChange={set('job_id')}><option value="">Not linked</option>{(jobs || []).map((j) => <option key={j.id} value={j.id}>#{j.number} · {j.title} — {j.client_name}</option>)}</select></Field>
        {office && <Field label="Paid by"><select value={f.user_id || ''} onChange={set('user_id')}>{(team || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>}
        <div className="field" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <label className="check"><input type="checkbox" checked={!!f.reimbursable} onChange={set('reimbursable')} /> Reimburse to team member</label>
          {office && !!f.reimbursable && <label className="check"><input type="checkbox" checked={!!f.reimbursed} onChange={set('reimbursed')} /> Reimbursed</label>}
        </div>
        <Field label="Description" full><textarea value={f.description || ''} onChange={set('description')} /></Field>
        {!expense && <Field label="Receipt" full><input type="file" multiple accept="image/*,application/pdf" onChange={(e) => setFiles([...e.target.files])} /></Field>}
      </div>
      {expense && <div className="mt"><Attachments type="expense" id={expense.id} title="Receipts" /></div>}
    </Modal>
  );
}

export default function Expenses() {
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState({ from: ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: ymd() });
  const { data, loading, reload } = useLoad(`/expenses${qs(range)}`);
  const [edit, setEdit] = useState(null);
  const creating = params.get('new') === '1';
  const total = (data || []).reduce((s, e) => s + e.amount, 0);
  const byCat = Object.entries((data || []).reduce((a, e) => ((a[e.category || 'Other'] = (a[e.category || 'Other'] || 0) + e.amount), a), {})).sort((a, b) => b[1] - a[1]);
  const toReimburse = (data || []).filter((e) => e.reimbursable && !e.reimbursed).reduce((s, e) => s + e.amount, 0);

  return (
    <div>
      <PageHead title="Expenses" sub="Log receipts, attach them to jobs and track who gets reimbursed. Everything feeds job costing and payroll.">
        <button className="btn primary" onClick={() => setParams({ new: '1' })}><Plus size={16} /> Add expense</button>
      </PageHead>
      <div className="row wrap mb">
        <Field label="From"><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="To"><input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
      </div>
      <div className="grid g3 mb">
        <div className="card stat"><div className="label">Total spend</div><div className="value">{money(total)}</div><div className="hint">{(data || []).length} expenses</div></div>
        <div className="card stat"><div className="label">To reimburse</div><div className="value">{money(toReimburse)}</div></div>
        <div className="card stat"><div className="label">Top category</div><div className="value" style={{ fontSize: 20 }}>{byCat[0]?.[0] || '—'}</div><div className="hint">{byCat[0] ? money(byCat[0][1]) : ''}</div></div>
      </div>
      <div className="card">
        {loading && !data ? <Loading /> : data.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Date</th><th>Item</th><th className="hide-sm">Category</th><th className="hide-sm">Job</th><th className="hide-sm">Paid by</th><th className="num">Amount</th></tr></thead>
            <tbody>{data.map((e) => (
              <tr key={e.id} className="clickable" onClick={() => setEdit(e)}>
                <td className="muted">{date(e.date)}</td>
                <td><span className="strong">{e.title}</span> {!!e.receipts && <Paperclip size={12} className="faint" />}{e.supplier && <div className="small muted">{e.supplier}</div>}</td>
                <td className="hide-sm">{e.category}</td><td className="hide-sm muted">{e.job_number ? `#${e.job_number} ${e.job_title}` : '—'}</td>
                <td className="hide-sm">{e.user_name}{!!e.reimbursable && <span className={`badge ${e.reimbursed ? 'green' : 'amber'}`} style={{ marginLeft: 6 }}>{e.reimbursed ? 'Reimbursed' : 'Reimburse'}</span>}</td>
                <td className="num strong">{money(e.amount)}</td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty icon={Wallet} title="Track your expenses" action={<button className="btn primary" onClick={() => setParams({ new: '1' })}>Log your first expense</button>}>Upload receipts and invoices, attach them to a job, and know who gets reimbursed.</Empty>}
      </div>
      {(creating || edit) && <ExpenseModal expense={edit} onClose={() => { setEdit(null); setParams({}); }} onSaved={() => { setEdit(null); setParams({}); reload(); }} />}
    </div>
  );
}
