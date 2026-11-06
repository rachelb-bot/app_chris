import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Receipt, Plus, MoreHorizontal, Pencil, Trash2, Send, Printer, Link2, Search, Ban, Banknote, X, FileText } from 'lucide-react';
import { api, qs } from '../api.js';
import { money, date, ymd } from '../format.js';
import { useLoad, useAction, Loading, ErrorBox, Status, Empty, Field, Dropdown, Chips, Confirm, Modal, useDebounced, useToast, useApp, isAdmin } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import { ClientPicker, PropertySelect, LineItemsEditor, TotalsEditor, Notes, Attachments, DocLines, useClient } from '../components/shared.jsx';
import { SendModal, DocHeader } from './Quotes.jsx';

export function InvoicesList() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'all';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading } = useLoad(`/invoices${qs({ status, q: dq })}`);
  const { data: stats } = useLoad('/invoices/stats');
  const nav = useNavigate();
  return (
    <div>
      <PageHead title="Invoices"><Link className="btn primary" to="/invoices/new"><Plus size={16} /> New invoice</Link></PageHead>
      {stats && (
        <div className="grid g4 mb">
          <button className="card stat" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => setParams({ status: 'overdue' })}><div className="label">Overdue</div><div className="value" style={{ color: stats.overdue.amount ? 'var(--red)' : undefined }}>{money(stats.overdue.amount)}</div><div className="hint">{stats.overdue.count} invoices</div></button>
          <button className="card stat" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => setParams({ status: 'unpaid' })}><div className="label">Awaiting payment</div><div className="value">{money(stats.awaiting.amount)}</div><div className="hint">{stats.awaiting.count} invoices</div></button>
          <button className="card stat" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => setParams({ status: 'draft' })}><div className="label">Draft</div><div className="value">{money(stats.draft.amount)}</div><div className="hint">{stats.draft.count} invoices</div></button>
          <div className="card stat"><div className="label">Received</div><div className="value">{money(stats.paid_30)}</div><div className="hint">Past 30 days</div></div>
        </div>
      )}
      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <Chips value={status} onChange={(s) => setParams({ status: s })} options={[['all', 'All'], ['draft', 'Draft'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']]} />
          <div className="search" style={{ maxWidth: 260 }}><Search size={16} /><input placeholder="Search invoices…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {loading && !data ? <Loading /> : data.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Client</th><th>Invoice</th><th className="hide-sm">Due</th><th>Status</th><th className="num">Total</th><th className="num">Balance</th></tr></thead>
            <tbody>{data.map((i) => (
              <tr key={i.id} className="clickable" onClick={() => nav(`/invoices/${i.id}`)}>
                <td className="strong">{i.client_name}</td><td>#{i.number} · {i.subject}</td><td className="hide-sm muted">{date(i.due_date)}</td><td><Status s={i.display_status} /></td><td className="num">{money(i.total)}</td><td className="num strong">{money(i.balance)}</td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty icon={Receipt} title="Create and send an invoice" action={<Link className="btn primary" to="/invoices/new"><Plus size={16} /> Create an invoice</Link>}>Invoice a completed job in one click, or create an invoice manually. Clients get a secure link to view it online.</Empty>}
      </div>
    </div>
  );
}

export function InvoiceForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { settings } = useApp();
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => {
    if (id) api.get(`/invoices/${id}`).then(setF).catch(() => {});
    else {
      const issue = ymd();
      const due = ymd(new Date(Date.now() + (Number(settings.invoice_terms_days) || 14) * 864e5));
      setF({ client_id: Number(params.get('client_id')) || null, property_id: null, subject: 'For services rendered', issue_date: issue, due_date: due, items: [], discount: 0, tax_rate: Number(settings.tax_rate) || 0, client_message: settings.invoice_message, notes: '' });
    }
  }, [id]);
  const { data: client } = useClient(f?.client_id);
  useEffect(() => { if (client && !f.property_id && client.properties[0]) setF((x) => ({ ...x, property_id: client.properties[0].id })); }, [client]);
  if (!f) return <Loading />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (then) => run(async () => {
    const body = { ...f, items: f.items.map(({ key, ...r }) => r) };
    return id ? (await api.put(`/invoices/${id}`, body), id) : (await api.post('/invoices', body)).id;
  }, 'Invoice saved').then((iid) => nav(`/invoices/${iid}${then === 'send' ? '?send=1' : ''}`)).catch(() => {});

  return (
    <div>
      <PageHead title={id ? `Edit invoice #${f.number}` : 'New invoice'} crumbs={<Link to="/invoices">Invoices</Link>} />
      <div className="stack">
        <div className="card card-pad">
          <div className="section-title">Client</div>
          <ClientPicker value={f.client_id} onChange={(cid) => setF({ ...f, client_id: cid, property_id: null })} />
          {client && <div className="mt"><PropertySelect client={client} value={f.property_id} onChange={(v) => setF({ ...f, property_id: v })} /></div>}
        </div>
        <div className="card card-pad">
          <div className="form-grid">
            <Field label="Subject" full><input value={f.subject} onChange={set('subject')} /></Field>
            <Field label="Issued date"><input type="date" value={f.issue_date} onChange={set('issue_date')} /></Field>
            <Field label="Payment due"><input type="date" value={f.due_date} onChange={set('due_date')} /></Field>
          </div>
        </div>
        <div className="card card-pad">
          <div className="section-title">Product / Service</div>
          <LineItemsEditor items={f.items} onChange={(items) => setF({ ...f, items })} />
          <div className="mt"><TotalsEditor items={f.items} discount={f.discount} tax_rate={f.tax_rate} onChange={(p) => setF({ ...f, ...p })} /></div>
        </div>
        <div className="card card-pad">
          <div className="form-grid">
            <Field label="Client message (shown on invoice)" full><textarea value={f.client_message || ''} onChange={set('client_message')} /></Field>
            <Field label="Internal notes (not shown to client)" full><textarea value={f.notes || ''} onChange={set('notes')} placeholder="Leave an internal note for yourself or a team member" /></Field>
          </div>
        </div>
        <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => nav(-1)}>Cancel</button>
          <button className="btn" disabled={busy} onClick={() => save()}>Save invoice</button>
          <button className="btn primary" disabled={busy} onClick={() => save('send')}><Send size={15} /> Save & send</button>
        </div>
      </div>
    </div>
  );
}

function PaymentModal({ inv, onClose, onSaved }) {
  const [f, setF] = useState({ amount: inv.totals.balance, method: 'bank_transfer', reference: '', paid_on: ymd() });
  const [run, busy] = useAction();
  return (
    <Modal title="Collect payment" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={() => run(() => api.post(`/invoices/${inv.id}/payments`, f), 'Payment recorded').then(onSaved).catch(() => {})}>Save payment</button></>}>
      <div className="form-grid">
        <Field label="Amount"><input type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
        <Field label="Date"><input type="date" value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} /></Field>
        <Field label="Method"><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
          <option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select></Field>
        <Field label="Reference"><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function InvoiceDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { user, settings } = useApp();
  const { data: inv, error, reload } = useLoad(`/invoices/${id}`);
  const [pay, setPay] = useState(false);
  const [del, setDel] = useState(false);
  const [run] = useAction();
  const toast = useToast();
  const nav = useNavigate();
  if (error) return <ErrorBox error={error} />;
  if (!inv) return <Loading />;
  const link = `${location.origin}/hub/invoice/${inv.public_token}`;
  const act = (fn, msg) => run(fn, msg).then(reload).catch(() => {});
  return (
    <div>
      <PageHead title={`Invoice #${inv.number}`} crumbs={<Link to="/invoices">Invoices</Link>} sub={<span className="row" style={{ gap: 8 }}><Status s={inv.display_status} /><span>for <Link to={`/clients/${inv.client_id}`} className="strong">{inv.client.name}</Link></span></span>}>
        {inv.status === 'draft' && <button className="btn primary" onClick={() => setParams({ send: '1' })}><Send size={15} /> Send invoice</button>}
        {!['void', 'paid'].includes(inv.status) && inv.totals.balance > 0 && <button className={`btn ${inv.status === 'draft' ? '' : 'primary'}`} onClick={() => setPay(true)}><Banknote size={15} /> Collect payment</button>}
        <Link className="btn" to={`/invoices/${inv.id}/edit`}><Pencil size={15} /> Edit</Link>
        <Dropdown className="btn icon" label={<MoreHorizontal size={18} />}>
          {inv.status !== 'draft' && inv.status !== 'void' && <button onClick={() => setParams({ send: '1' })}><Send size={15} /> Resend / reminder</button>}
          <button onClick={() => { if (inv.status === 'draft') return toast('Send the invoice first to activate the client link', 'error'); navigator.clipboard?.writeText(link); toast('Client link copied'); }}><Link2 size={15} /> Copy client link</button>
          <button disabled={inv.status === 'draft'} onClick={() => window.open(link, '_blank')}><FileText size={15} /> View as client</button>
          <button onClick={() => window.print()}><Printer size={15} /> Print / PDF</button>
          {inv.status === 'draft' && <button onClick={() => act(() => api.put(`/invoices/${inv.id}`, { status: 'sent' }), 'Marked as sent')}><Send size={15} /> Mark as sent</button>}
          {inv.status !== 'void' && inv.status !== 'paid' && <button onClick={() => act(() => api.put(`/invoices/${inv.id}`, { status: 'paid' }), 'Marked as paid')}><Banknote size={15} /> Mark as paid</button>}
          {inv.status !== 'void' && <button className="danger" onClick={() => confirm('Void this invoice? It will no longer count as owed.') && act(() => api.put(`/invoices/${inv.id}`, { status: 'void' }), 'Invoice voided')}><Ban size={15} /> Void</button>}
          {inv.status === 'draft' && isAdmin(user) && <button className="danger" onClick={() => setDel(true)}><Trash2 size={15} /> Delete</button>}
        </Dropdown>
      </PageHead>

      <div className="grid g-main-side">
        <div className="stack">
          <div className="card">
            <DocHeader settings={settings} client={inv.client} property={inv.property} title={inv.subject}
              meta={[['Invoice #', inv.number], ['Issued', date(inv.issue_date)], ['Due', date(inv.due_date)], ...(inv.job ? [['Job', <Link key="j" to={`/jobs/${inv.job.id}`}>#{inv.job.number}</Link>]] : [])]} />
            <DocLines items={inv.items} showOptional={false} />
            <div className="card-pad">
              <TotalsEditor items={inv.items} discount={inv.discount} tax_rate={inv.tax_rate} readOnly />
              <div className="totals"><div className="line"><span className="muted">Paid</span><span>−{money(inv.totals.paid)}</span></div><div className="line grand"><span>Balance due</span><span>{money(inv.totals.balance)}</span></div></div>
            </div>
            {inv.client_message && <div className="card-pad small muted pre" style={{ borderTop: '1px solid var(--border)' }}>{inv.client_message}{settings.bank_details && `\n\n${settings.bank_details}`}</div>}
          </div>
          <Attachments type="invoice" id={inv.id} />
        </div>
        <div className="stack no-print">
          <div className="card">
            <div className="card-head"><h3>Payments</h3>{!['void', 'paid'].includes(inv.status) && <button className="btn sm" onClick={() => setPay(true)}><Plus size={14} /> Add</button>}</div>
            <ul className="list-plain" style={{ padding: '0 20px' }}>
              {inv.payments.map((p) => (
                <li key={p.id} className="row"><div style={{ flex: 1 }}><b>{money(p.amount)}</b><div className="small muted">{date(p.paid_on)} · {p.method.replace('_', ' ')}{p.reference ? ` · ${p.reference}` : ''}</div></div>
                  <button className="btn ghost icon sm" aria-label="Delete payment" onClick={() => confirm('Delete this payment?') && act(() => api.del(`/payments/${p.id}`), 'Payment removed')}><X size={14} /></button></li>
              ))}
              {!inv.payments.length && <li className="muted">No payments yet.</li>}
            </ul>
          </div>
          {inv.notes && <div className="card card-pad"><h3 className="mb">Internal notes</h3><p className="pre small">{inv.notes}</p></div>}
          <Notes type="invoice" id={inv.id} />
        </div>
      </div>
      {params.get('send') === '1' && <SendModal kind="invoice" doc={inv} onClose={() => setParams({})} onSent={(r) => { setParams({}); toast(r.delivery === 'sent' ? 'Invoice emailed to client' : 'Invoice marked as sent (email logged)'); reload(); }} />}
      {pay && <PaymentModal inv={inv} onClose={() => setPay(false)} onSaved={() => { setPay(false); reload(); }} />}
      {del && <Confirm danger title="Delete draft invoice?" confirmLabel="Delete" onClose={() => setDel(false)} onConfirm={() => api.del(`/invoices/${inv.id}`).then(() => nav('/invoices'))}>Invoice #{inv.number} will be permanently removed.</Confirm>}
    </div>
  );
}
