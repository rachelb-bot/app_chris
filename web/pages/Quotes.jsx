import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FileText, Plus, MoreHorizontal, Pencil, Trash2, Copy, Send, Printer, Wrench, CheckCircle2, Link2, Search, LayoutTemplate, Archive } from 'lucide-react';
import { api, qs } from '../api.js';
import { money, date, dateTime } from '../format.js';
import { useLoad, useAction, Loading, ErrorBox, Status, Empty, Field, Dropdown, Chips, Confirm, Modal, useDebounced, useToast, useApp } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import { ClientPicker, PropertySelect, LineItemsEditor, TotalsEditor, Notes, Attachments, DocLines, useClient } from '../components/shared.jsx';

export function QuotesList() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading } = useLoad(`/quotes${qs({ status, q: dq })}`);
  const { data: all } = useLoad('/quotes?status=all');
  const nav = useNavigate();
  const sum = (s) => (all || []).filter((x) => x.status === s);
  return (
    <div>
      <PageHead title="Quotes">
        <Link className="btn" to="/quotes/new?template=1"><LayoutTemplate size={15} /> Use a template</Link>
        <Link className="btn primary" to="/quotes/new"><Plus size={16} /> New quote</Link>
      </PageHead>
      {all && (
        <div className="grid g4 mb">
          {[['draft', 'Draft'], ['sent', 'Awaiting response'], ['changes_requested', 'Changes requested'], ['approved', 'Approved']].map(([s, l]) => (
            <button key={s} className="card stat" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => setParams({ status: s })}>
              <div className="label">{l}</div><div className="value">{sum(s).length}</div><div className="hint">{money(sum(s).reduce((a, x) => a + x.total, 0))}</div>
            </button>
          ))}
        </div>
      )}
      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <Chips value={status} onChange={(s) => setParams(s ? { status: s } : {})} options={[['', 'All open'], ['draft', 'Draft'], ['sent', 'Awaiting response'], ['changes_requested', 'Changes requested'], ['approved', 'Approved'], ['converted', 'Converted'], ['archived', 'Archived']]} />
          <div className="search" style={{ maxWidth: 260 }}><Search size={16} /><input placeholder="Search quotes…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {loading && !data ? <Loading /> : data.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Client</th><th>Quote</th><th className="hide-sm">Created</th><th>Status</th><th className="num">Total</th></tr></thead>
            <tbody>{data.map((x) => (
              <tr key={x.id} className="clickable" onClick={() => nav(`/quotes/${x.id}`)}>
                <td className="strong">{x.client_name}</td><td>#{x.number} · {x.title}</td><td className="hide-sm muted">{date(x.created_at)}</td><td><Status s={x.status} /></td><td className="num strong">{money(x.total)}</td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty icon={FileText} title="Create a quote" action={<div className="btn-group" style={{ justifyContent: 'center' }}><Link className="btn" to="/quotes/new?template=1">Use a template</Link><Link className="btn primary" to="/quotes/new">Create a quote</Link></div>}>
          Start from an electrical template or create a quote manually. Clients can approve quotes online.
        </Empty>}
      </div>
    </div>
  );
}

function TemplatePicker({ onPick, onClose }) {
  const { data } = useLoad('/quote-templates');
  return (
    <Modal title="Choose a quote template" onClose={onClose} wide>
      {!data ? <Loading /> : (
        <div className="grid g2">
          {data.map((t) => (
            <button key={t.id} className="card card-pad" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => onPick(t)}>
              <div className="strong">{t.name}</div>
              <div className="small muted mt-s" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.intro}</div>
              <div className="small mt-s">{t.items.length} line items · {money(t.items.filter((i) => !i.optional).reduce((s, i) => s + i.quantity * i.unit_price, 0))}</div>
            </button>
          ))}
          {!data.length && <p className="muted">No templates yet. Create them in Settings → Quote templates.</p>}
        </div>
      )}
    </Modal>
  );
}

export function QuoteForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { settings } = useApp();
  const [f, setF] = useState(null);
  const [tpl, setTpl] = useState(params.get('template') === '1');
  const [run, busy] = useAction();
  useEffect(() => {
    (async () => {
      if (id) { const q = await api.get(`/quotes/${id}`); setF(q); return; }
      const base = { client_id: Number(params.get('client_id')) || null, property_id: null, title: '', intro: '', items: [], discount: 0, tax_rate: Number(settings.tax_rate) || 0, deposit: 0, client_message: '', terms: settings.quote_terms, valid_until: '' };
      const rid = params.get('request_id');
      if (rid) {
        const r = await api.get(`/requests/${rid}`);
        Object.assign(base, { request_id: r.id, client_id: r.client_id, property_id: r.property_id, title: r.title, intro: r.details || '', items: r.items });
      }
      setF(base);
    })().catch(() => {});
  }, [id]);
  const { data: client } = useClient(f?.client_id);
  useEffect(() => { if (client && !f.property_id && client.properties[0]) setF((x) => ({ ...x, property_id: client.properties[0].id })); }, [client]);
  if (!f) return <Loading />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (then) => run(async () => {
    const body = { ...f, items: f.items.map(({ key, ...rest }) => rest) };
    const qid = id ? (await api.put(`/quotes/${id}`, body), id) : (await api.post('/quotes', body)).id;
    return qid;
  }, 'Quote saved').then((qid) => nav(`/quotes/${qid}${then === 'send' ? '?send=1' : ''}`)).catch(() => {});

  return (
    <div>
      <PageHead title={id ? `Edit quote #${f.number}` : 'New quote'} crumbs={<Link to="/quotes">Quotes</Link>}>
        {!id && <button className="btn" onClick={() => setTpl(true)}><LayoutTemplate size={15} /> Use a template</button>}
      </PageHead>
      <div className="stack">
        <div className="card card-pad">
          <div className="section-title">Client</div>
          <ClientPicker value={f.client_id} onChange={(cid) => setF({ ...f, client_id: cid, property_id: null })} />
          {client && <div className="mt"><PropertySelect client={client} value={f.property_id} onChange={(v) => setF({ ...f, property_id: v })} /></div>}
        </div>
        <div className="card card-pad">
          <div className="form-grid">
            <Field label="Quote title" full><input value={f.title} onChange={set('title')} placeholder="e.g. Electrical Panel Upgrade (100A service)" /></Field>
            <Field label="Introduction" full><textarea rows={5} value={f.intro || ''} onChange={set('intro')} placeholder="Describe the scope of work for the client" /></Field>
          </div>
        </div>
        <div className="card card-pad">
          <div className="section-title">Product / Service</div>
          <LineItemsEditor items={f.items} onChange={(items) => setF({ ...f, items })} allowOptional />
          <div className="mt"><TotalsEditor items={f.items} discount={f.discount} tax_rate={f.tax_rate} deposit={f.deposit} showDeposit onChange={(p) => setF({ ...f, ...p })} /></div>
        </div>
        <div className="card card-pad">
          <div className="form-grid">
            <Field label="Client message" full><textarea value={f.client_message || ''} onChange={set('client_message')} placeholder="Shown on the quote" /></Field>
            <Field label="Terms & conditions" full><textarea value={f.terms || ''} onChange={set('terms')} /></Field>
            <Field label="Valid until"><input type="date" value={f.valid_until || ''} onChange={set('valid_until')} /></Field>
          </div>
        </div>
        <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => nav(-1)}>Cancel</button>
          <button className="btn" disabled={busy} onClick={() => save()}>Save quote</button>
          <button className="btn primary" disabled={busy} onClick={() => save('send')}><Send size={15} /> Save & send</button>
        </div>
      </div>
      {tpl && <TemplatePicker onClose={() => setTpl(false)} onPick={(t) => { setF({ ...f, title: t.title || t.name, intro: t.intro, items: t.items.map((i) => ({ ...i, selected: i.optional ? 0 : 1, key: Math.random() })) }); setTpl(false); }} />}
    </div>
  );
}

export function SendModal({ kind, doc, onClose, onSent }) {
  const { settings, emailEnabled } = useApp();
  const [f, setF] = useState({ to: doc.client.email || '', subject: `${kind === 'quote' ? 'Quote' : 'Invoice'} #${doc.number} from ${settings.company_name}`, message: '' });
  const [run, busy] = useAction();
  return (
    <Modal title={`Email ${kind} to client`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !f.to} onClick={() => run(() => api.post(`/${kind}s/${doc.id}/send`, f)).then((r) => onSent(r)).catch(() => {})}><Send size={15} /> Send</button></>}>
      {!emailEnabled && <div className="notice blue mb small">Email delivery isn't configured on this server yet (set SMTP_* environment variables). The message will be logged and the {kind} marked as sent — you can copy the client link to send it yourself.</div>}
      <div className="stack">
        <Field label="To"><input type="email" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="Subject"><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Message" hint="Leave blank to use the standard message, which includes a secure link to view online."><textarea rows={6} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function DocHeader({ settings, client, property, title, meta }) {
  return (
    <div className="doc-head">
      <div>
        <div className="strong" style={{ fontSize: 16 }}>{settings.company_name}</div>
        <div className="small muted pre">{[settings.company_address, settings.company_phone, settings.company_email, settings.vat_no && `${settings.tax_label || 'VAT'} No. ${settings.vat_no}`].filter(Boolean).join('\n')}</div>
        <div className="section-title" style={{ marginTop: 18 }}>Recipient</div>
        <div className="strong">{client.name}</div>
        <div className="small muted pre">{[property?.address, client.email, client.phone].filter(Boolean).join('\n')}</div>
      </div>
      <div>
        <h2 style={{ marginBottom: 10 }}>{title}</h2>
        <dl className="doc-meta">{meta.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
      </div>
    </div>
  );
}

export function QuoteDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { settings } = useApp();
  const { data: q, error, reload } = useLoad(`/quotes/${id}`);
  const [del, setDel] = useState(false);
  const [run] = useAction();
  const toast = useToast();
  const nav = useNavigate();
  if (error) return <ErrorBox error={error} />;
  if (!q) return <Loading />;
  const sending = params.get('send') === '1';
  const link = `${location.origin}/hub/quote/${q.public_token}`;
  const setStatus = (status, msg) => run(() => api.put(`/quotes/${q.id}`, { status }), msg).then(reload).catch(() => {});

  return (
    <div>
      <PageHead title={`Quote #${q.number}`} crumbs={<Link to="/quotes">Quotes</Link>} sub={<span className="row" style={{ gap: 8 }}><Status s={q.status} /><span>for <Link to={`/clients/${q.client_id}`} className="strong">{q.client.name}</Link></span></span>}>
        {['draft', 'changes_requested'].includes(q.status) && <button className="btn primary" onClick={() => setParams({ send: '1' })}><Send size={15} /> Send to client</button>}
        {['sent', 'approved'].includes(q.status) && <button className="btn primary" onClick={() => run(() => api.post(`/quotes/${q.id}/convert`), 'Job created').then((r) => nav(`/jobs/${r.id}`)).catch(() => {})}><Wrench size={15} /> Convert to job</button>}
        <Link className="btn" to={`/quotes/${q.id}/edit`}><Pencil size={15} /> Edit</Link>
        <Dropdown className="btn icon" label={<MoreHorizontal size={18} />}>
          {q.status !== 'draft' && q.status !== 'sent' ? null : <button onClick={() => setParams({ send: '1' })}><Send size={15} /> {q.status === 'sent' ? 'Resend' : 'Send'}</button>}
          {q.status !== 'approved' && q.status !== 'converted' && <button onClick={() => setStatus('approved', 'Marked approved')}><CheckCircle2 size={15} /> Mark as approved</button>}
          {q.status === 'draft' && <button onClick={() => setStatus('sent', 'Marked sent')}><Send size={15} /> Mark as sent</button>}
          <button onClick={() => { if (q.status === 'draft') return toast('Send the quote first to activate the client link', 'error'); navigator.clipboard?.writeText(link); toast('Client link copied'); }}><Link2 size={15} /> Copy client link</button>
          <button onClick={() => window.open(link, '_blank')} disabled={q.status === 'draft'}><FileText size={15} /> View as client</button>
          <button onClick={() => window.print()}><Printer size={15} /> Print / PDF</button>
          <button onClick={() => run(() => api.post(`/quotes/${q.id}/duplicate`), 'Quote duplicated').then((r) => nav(`/quotes/${r.id}`)).catch(() => {})}><Copy size={15} /> Duplicate</button>
          {q.status !== 'archived' && <button onClick={() => setStatus('archived', 'Archived')}><Archive size={15} /> Archive</button>}
          <button className="danger" onClick={() => setDel(true)}><Trash2 size={15} /> Delete</button>
        </Dropdown>
      </PageHead>

      {q.status === 'changes_requested' && q.client_feedback && <div className="notice red mb"><b>Client requested changes:</b> {q.client_feedback}</div>}
      {q.client_signature && <div className="notice green mb">Approved online by <b>{q.client_signature}</b> on {dateTime(q.approved_at)}</div>}
      {!!q.jobs.length && <div className="notice blue mb">Converted to {q.jobs.map((j) => <Link key={j.id} to={`/jobs/${j.id}`} className="strong" style={{ marginRight: 8 }}>Job #{j.number}</Link>)}</div>}

      <div className="grid g-main-side">
        <div className="stack">
          <div className="card">
            <DocHeader settings={settings} client={q.client} property={q.property} title={q.title}
              meta={[['Quote #', q.number], ['Created', date(q.created_at)], ['Valid until', date(q.valid_until)], ...(q.sent_at ? [['Sent', date(q.sent_at)]] : [])]} />
            {q.intro && <div className="card-pad pre" style={{ borderBottom: '1px solid var(--border)' }}>{q.intro}</div>}
            <DocLines items={q.items} />
            <div className="card-pad"><TotalsEditor items={q.items} discount={q.discount} tax_rate={q.tax_rate} deposit={q.deposit} showDeposit={q.deposit > 0} readOnly /></div>
            {(q.client_message || q.terms) && <div className="card-pad small muted pre" style={{ borderTop: '1px solid var(--border)' }}>{[q.client_message, q.terms].filter(Boolean).join('\n\n')}</div>}
          </div>
          <Attachments type="quote" id={q.id} />
        </div>
        <div className="stack no-print">
          <div className="card card-pad">
            <h3 className="mb">Profitability</h3>
            <div className="row"><span className="muted">Line item cost</span><span className="spacer" />{money(q.totals.cost)}</div>
            <div className="row mt-s"><span className="muted">Margin</span><span className="spacer" /><b>{money(q.totals.subtotal - q.totals.cost)} ({q.totals.subtotal ? Math.round(((q.totals.subtotal - q.totals.cost) / q.totals.subtotal) * 100) : 0}%)</b></div>
          </div>
          <Notes type="quote" id={q.id} />
        </div>
      </div>
      {sending && <SendModal kind="quote" doc={q} onClose={() => setParams({})} onSent={(r) => { setParams({}); toast(r.delivery === 'sent' ? 'Quote emailed to client' : 'Quote marked as sent (email logged)'); reload(); }} />}
      {del && <Confirm danger title="Delete quote?" confirmLabel="Delete" onClose={() => setDel(false)} onConfirm={() => api.del(`/quotes/${q.id}`).then(() => nav('/quotes'))}>Quote #{q.number} will be permanently removed.</Confirm>}
    </div>
  );
}
