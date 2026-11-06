import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Inbox, Plus, MoreHorizontal, Pencil, Trash2, Archive, FileText, Wrench, Search, Link2 } from 'lucide-react';
import { api, qs } from '../api.js';
import { money, date, dateTime, toLocalInput, fromLocalInput, ago } from '../format.js';
import { useLoad, useAction, Loading, ErrorBox, Status, Empty, Field, Dropdown, Chips, Confirm, useDebounced, useToast } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import { ClientPicker, PropertySelect, LineItemsEditor, Notes, Attachments, DocLines, useClient } from '../components/shared.jsx';

export function RequestsList() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading } = useLoad(`/requests${qs({ status, q: dq })}`);
  const nav = useNavigate();
  const toast = useToast();
  const bookingUrl = `${location.origin}/hub/book`;
  return (
    <div>
      <PageHead title="Requests" sub="New work enquiries from clients — book an assessment, then quote or schedule.">
        <button className="btn" onClick={() => { navigator.clipboard?.writeText(bookingUrl); toast('Online booking form link copied'); }}><Link2 size={15} /> Copy booking form link</button>
        <Link className="btn primary" to="/requests/new"><Plus size={16} /> New request</Link>
      </PageHead>
      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <Chips value={status} onChange={(s) => setParams(s ? { status: s } : {})} options={[['', 'Open'], ['new', 'New'], ['assessment', 'Assessment scheduled'], ['converted', 'Converted'], ['archived', 'Archived'], ['all', 'All']]} />
          <div className="search" style={{ maxWidth: 260 }}><Search size={16} /><input placeholder="Search requests…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {loading && !data ? <Loading /> : data.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Client</th><th>Title</th><th className="hide-sm">Source</th><th>Requested</th><th>Status</th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => nav(`/requests/${r.id}`)}>
                <td><div className="strong">{r.client_name}</div><div className="small muted">{r.phone || r.email}</div></td>
                <td>{r.title}{r.assessment_start && <div className="small muted">Assessment {dateTime(r.assessment_start)}</div>}</td>
                <td className="hide-sm muted">{r.source || '—'}</td><td className="muted">{ago(r.created_at)}</td><td><Status s={r.status} /></td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty icon={Inbox} title="No requests here" action={<Link className="btn primary" to="/requests/new"><Plus size={16} /> Create a request</Link>}>Requests capture the details you need when a client reaches out about new work.</Empty>}
      </div>
    </div>
  );
}

export function RequestForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { data: team } = useLoad('/users');
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => {
    if (id) api.get(`/requests/${id}`).then((r) => setF({ ...r, assessment_start: toLocalInput(r.assessment_start), assessment_end: toLocalInput(r.assessment_end) }));
    else setF({ client_id: Number(params.get('client_id')) || null, property_id: null, title: '', details: '', source: 'Phone', assessment_start: '', assessment_end: '', assigned_to: '', items: [] });
  }, [id]);
  const { data: client } = useClient(f?.client_id);
  useEffect(() => { if (client && !f.property_id && client.properties[0]) setF((x) => ({ ...x, property_id: client.properties[0].id })); }, [client]);
  if (!f) return <Loading />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => run(async () => {
    const body = { ...f, assessment_start: fromLocalInput(f.assessment_start), assessment_end: fromLocalInput(f.assessment_end) || (f.assessment_start ? new Date(new Date(f.assessment_start).getTime() + 3600e3).toISOString() : null), assigned_to: f.assigned_to || null };
    if (id) { await api.put(`/requests/${id}`, body); return id; }
    return (await api.post('/requests', body)).id;
  }, 'Request saved').then((rid) => nav(`/requests/${rid}`)).catch(() => {});

  return (
    <div>
      <PageHead title={id ? 'Edit request' : 'New request'} crumbs={<Link to="/requests">Requests</Link>} />
      <div className="stack">
        <div className="card card-pad">
          <div className="section-title">Client</div>
          <ClientPicker value={f.client_id} onChange={(cid) => setF({ ...f, client_id: cid, property_id: null })} />
          {client && <div className="mt"><PropertySelect client={client} value={f.property_id} onChange={(v) => setF({ ...f, property_id: v })} /></div>}
        </div>
        <div className="card card-pad">
          <div className="form-grid">
            <Field label="Request title" full><input value={f.title} onChange={set('title')} placeholder="e.g. Tripping RCD in kitchen" /></Field>
            <Field label="Service details" full><textarea rows={4} value={f.details || ''} onChange={set('details')} placeholder="Please provide as much information as you can" /></Field>
            <Field label="Source"><select value={f.source || ''} onChange={set('source')}>{['Phone', 'Email', 'Website', 'Online booking', 'Walk-in', 'Referral', 'Other'].map((s) => <option key={s}>{s}</option>)}</select></Field>
          </div>
        </div>
        <div className="card card-pad">
          <div className="section-title">On-site assessment</div>
          <p className="muted small mb">Visit the property to assess the job before you do the work.</p>
          <div className="form-grid">
            <Field label="Start"><input type="datetime-local" value={f.assessment_start || ''} onChange={set('assessment_start')} /></Field>
            <Field label="End"><input type="datetime-local" value={f.assessment_end || ''} onChange={set('assessment_end')} /></Field>
            <Field label="Assign to"><select value={f.assigned_to || ''} onChange={set('assigned_to')}><option value="">Unassigned</option>{(team || []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          </div>
        </div>
        <div className="card card-pad">
          <div className="section-title">Product / Service</div>
          <p className="muted small mb">Keep everything on track by adding products and services the client asked about.</p>
          <LineItemsEditor items={f.items} onChange={(items) => setF({ ...f, items })} showCost={false} />
        </div>
        <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => nav(-1)}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={save}>Save request</button>
        </div>
      </div>
    </div>
  );
}

export function RequestDetail() {
  const { id } = useParams();
  const { data: r, error, reload } = useLoad(`/requests/${id}`);
  const [del, setDel] = useState(false);
  const [run] = useAction();
  const nav = useNavigate();
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  return (
    <div>
      <PageHead title={r.title} crumbs={<Link to="/requests">Requests</Link>} sub={<span className="row" style={{ gap: 8 }}><Status s={r.status} /><span>for <Link to={`/clients/${r.client_id}`} className="strong">{r.client.name}</Link></span></span>}>
        <Link className="btn" to={`/quotes/new?request_id=${r.id}`}><FileText size={15} /> Convert to quote</Link>
        <Link className="btn primary" to={`/jobs/new?request_id=${r.id}`}><Wrench size={15} /> Convert to job</Link>
        <Dropdown className="btn icon" label={<MoreHorizontal size={18} />}>
          <button onClick={() => nav(`/requests/${r.id}/edit`)}><Pencil size={15} /> Edit</button>
          {r.status !== 'archived' ? <button onClick={() => run(() => api.put(`/requests/${r.id}`, { status: 'archived' }), 'Archived').then(reload)}><Archive size={15} /> Archive</button>
            : <button onClick={() => run(() => api.put(`/requests/${r.id}`, { status: 'new' }), 'Restored').then(reload)}><Archive size={15} /> Restore</button>}
          <button className="danger" onClick={() => setDel(true)}><Trash2 size={15} /> Delete</button>
        </Dropdown>
      </PageHead>
      <div className="grid g-main-side">
        <div className="stack">
          <div className="card card-pad">
            <h3 className="mb">Request details</h3>
            <dl className="kv">
              <dt>Requested</dt><dd>{dateTime(r.created_at)}</dd>
              <dt>Source</dt><dd>{r.source || '—'}</dd>
              <dt>Property</dt><dd>{r.property?.address || '—'}</dd>
              <dt>Details</dt><dd className="pre">{r.details || '—'}</dd>
            </dl>
          </div>
          <div className="card card-pad">
            <h3 className="mb">Assessment</h3>
            {r.assessment_start ? <dl className="kv"><dt>When</dt><dd>{dateTime(r.assessment_start)} – {r.assessment_end ? dateTime(r.assessment_end) : ''}</dd><dt>Assigned</dt><dd>{r.assignee?.name || 'Unassigned'}</dd></dl>
              : <div className="row"><span className="muted">No assessment scheduled.</span><span className="spacer" /><Link className="btn sm" to={`/requests/${r.id}/edit`}>Schedule assessment</Link></div>}
          </div>
          {!!r.items.length && <div className="card"><div className="card-head"><h3>Products / services requested</h3><b>{money(r.totals.subtotal)}</b></div><DocLines items={r.items} /></div>}
          {!!r.quotes.length && <div className="card card-pad"><h3 className="mb">Quotes from this request</h3>{r.quotes.map((q) => <div key={q.id} className="row"><Link to={`/quotes/${q.id}`}>Quote #{q.number} · {q.title}</Link><Status s={q.status} /></div>)}</div>}
          <Attachments type="request" id={r.id} />
        </div>
        <div className="stack">
          <div className="card card-pad">
            <h3 className="mb">Client</h3>
            <Link to={`/clients/${r.client_id}`} className="strong">{r.client.name}</Link>
            <div className="small muted mt-s">{r.client.email}<br />{r.client.phone}</div>
          </div>
          <Notes type="request" id={r.id} />
        </div>
      </div>
      {del && <Confirm danger title="Delete request?" confirmLabel="Delete" onClose={() => setDel(false)} onConfirm={() => api.del(`/requests/${r.id}`).then(() => nav('/requests'))}>This request will be permanently removed.</Confirm>}
    </div>
  );
}
