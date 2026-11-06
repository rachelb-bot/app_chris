import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Wrench, Plus, MoreHorizontal, Pencil, Trash2, Archive, Receipt, CheckCircle2, Search, CalendarPlus, Circle, RotateCcw, X } from 'lucide-react';
import { api, qs } from '../api.js';
import { money, date, time, dateTime, toLocalInput, fromLocalInput, hours, ymd } from '../format.js';
import { useLoad, useAction, Loading, ErrorBox, Status, Empty, Field, Dropdown, Chips, Confirm, Modal, useDebounced, useApp, isOffice, isAdmin, Avatars, Avatar, askConfirm } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import { ClientPicker, PropertySelect, LineItemsEditor, TotalsEditor, Notes, Attachments, DocLines, useClient } from '../components/shared.jsx';

export function JobsList() {
  const { user } = useApp();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading } = useLoad(`/jobs${qs({ status, q: dq })}`);
  const nav = useNavigate();
  const office = isOffice(user);
  return (
    <div>
      <PageHead title="Jobs">{office && <Link className="btn primary" to="/jobs/new"><Plus size={16} /> New job</Link>}</PageHead>
      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <Chips value={status} onChange={(s) => setParams(s ? { status: s } : {})} options={[['', 'All open'], ['active', 'Active'], ['late', 'Late'], ['unscheduled', 'Unscheduled'], ['action_required', 'Action required'], ['requires_invoicing', 'Requires invoicing'], ['completed', 'Completed'], ['archived', 'Archived']]} />
          <div className="search" style={{ maxWidth: 260 }}><Search size={16} /><input placeholder="Search jobs…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {loading && !data ? <Loading /> : data.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Client</th><th>Job</th><th className="hide-sm">Next visit</th><th>Status</th>{office && <th className="num">Value</th>}</tr></thead>
            <tbody>{data.map((j) => (
              <tr key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}>
                <td className="strong">{j.client_name}</td>
                <td>#{j.number} · {j.title}{j.job_type === 'recurring' && <span className="badge" style={{ marginLeft: 6 }}>Recurring</span>}</td>
                <td className="hide-sm muted">{j.next_visit ? dateTime(j.next_visit) : '—'}</td>
                <td><Status s={j.display_status} /></td>{office && <td className="num strong">{money(j.subtotal)}</td>}
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty icon={Wrench} title="Manage jobs" action={office && <Link className="btn primary" to="/jobs/new"><Plus size={16} /> Create a job</Link>}>Schedule and assign work to your electricians. Jobs can be created from approved quotes or directly.</Empty>}
      </div>
    </div>
  );
}

function TeamSelect({ value = [], onChange }) {
  const { data: team } = useLoad('/users');
  return (
    <div className="chips">
      {(team || []).filter((u) => u.active).map((u) => {
        const on = value.includes(u.id);
        return <button key={u.id} type="button" className={`chip${on ? ' on' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== u.id) : [...value, u.id])}>
          <span className="row" style={{ gap: 6 }}><Avatar sm name={u.name} color={u.color} />{u.name}</span></button>;
      })}
    </div>
  );
}

function defaultVisit(dateStr) {
  const s = new Date(`${dateStr || ymd()}T09:00`);
  return { start: toLocalInput(s.toISOString()), end: toLocalInput(new Date(s.getTime() + 2 * 3600e3).toISOString()), anytime: false, assignees: [], instructions: '', repeat: 'none', occurrences: 4 };
}

export function JobForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { user } = useApp();
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => {
    (async () => {
      if (id) { const j = await api.get(`/jobs/${id}`); setF({ ...j, visit: null }); return; }
      const base = { client_id: Number(params.get('client_id')) || null, property_id: null, title: '', instructions: '', job_type: 'one_off', billing: 'on_completion', items: [], visit: { ...defaultVisit(params.get('date')), assignees: [user.id] }, schedule: true, checklist: ['Safe isolation confirmed', 'Test results recorded', 'Certificate issued to client'], certificate_no: '' };
      if (params.get('request_id')) {
        const r = await api.get(`/requests/${params.get('request_id')}`);
        Object.assign(base, { request_id: r.id, client_id: r.client_id, property_id: r.property_id, title: r.title, instructions: r.details || '', items: r.items });
      }
      setF(base);
    })().catch(() => {});
  }, [id]);
  const { data: client } = useClient(f?.client_id);
  useEffect(() => { if (client && !f.property_id && client.properties[0]) setF((x) => ({ ...x, property_id: client.properties[0].id })); }, [client]);
  if (!f) return <Loading />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const v = f.visit;
  const setV = (patch) => setF({ ...f, visit: { ...f.visit, ...patch } });
  const save = () => run(async () => {
    const body = { ...f, items: f.items.map(({ key, ...r }) => r) };
    if (id) { await api.put(`/jobs/${id}`, body); return id; }
    if (f.schedule && v) {
      const start = v.anytime ? new Date(v.start.slice(0, 10) + 'T08:00').toISOString() : fromLocalInput(v.start);
      const end = v.anytime ? new Date(v.start.slice(0, 10) + 'T17:00').toISOString() : fromLocalInput(v.end);
      body.visits = [];
      const n = f.job_type === 'recurring' && v.repeat !== 'none' ? Math.min(Number(v.occurrences) || 1, 104) : 1;
      for (let i = 0; i < n; i++) {
        const shift = (iso) => { const d = new Date(iso); if (v.repeat === 'monthly') d.setMonth(d.getMonth() + i); else d.setDate(d.getDate() + 7 * i); return d.toISOString(); };
        body.visits.push({ start_at: shift(start), end_at: shift(end), anytime: v.anytime, assignees: v.assignees, instructions: v.instructions });
      }
    }
    body.checklist = f.checklist.filter(Boolean);
    return (await api.post('/jobs', body)).id;
  }, 'Job saved').then((jid) => nav(`/jobs/${jid}`)).catch(() => {});

  return (
    <div>
      <PageHead title={id ? `Edit job #${f.number}` : 'New job'} crumbs={<Link to="/jobs">Jobs</Link>} />
      <div className="stack">
        <div className="card card-pad">
          <div className="section-title">Client</div>
          <ClientPicker value={f.client_id} onChange={(cid) => setF({ ...f, client_id: cid, property_id: null })} />
          {client && <div className="mt"><PropertySelect client={client} value={f.property_id} onChange={(val) => setF({ ...f, property_id: val })} /></div>}
        </div>
        <div className="card card-pad">
          <div className="form-grid">
            <Field label="Job title" full><input value={f.title} onChange={set('title')} placeholder="e.g. Consumer unit replacement" /></Field>
            <Field label="Instructions" full><textarea rows={4} value={f.instructions || ''} onChange={set('instructions')} placeholder="Scope, access, isolation points, materials to bring…" /></Field>
            <Field label="Job type"><select value={f.job_type} onChange={set('job_type')}><option value="one_off">One-off job</option><option value="recurring">Recurring job (e.g. periodic maintenance)</option></select></Field>
            <Field label="Invoicing"><select value={f.billing} onChange={set('billing')}><option value="on_completion">Invoice when job is closed</option><option value="per_visit">Invoice after each visit</option><option value="none">Don't remind me to invoice</option></select></Field>
            <Field label="Certificate number (optional)"><input value={f.certificate_no || ''} onChange={set('certificate_no')} /></Field>
          </div>
        </div>
        {!id && (
          <div className="card card-pad">
            <div className="row mb"><div className="section-title" style={{ margin: 0 }}>Schedule</div><span className="spacer" />
              <label className="check small"><input type="checkbox" checked={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.checked })} /> Schedule a visit now</label></div>
            {f.schedule && (
              <div className="form-grid">
                <Field label={v.anytime ? 'Date' : 'Start'}><input type={v.anytime ? 'date' : 'datetime-local'} value={v.anytime ? v.start.slice(0, 10) : v.start} onChange={(e) => setV({ start: v.anytime ? e.target.value + v.start.slice(10) : e.target.value })} /></Field>
                {!v.anytime && <Field label="End"><input type="datetime-local" value={v.end} onChange={(e) => setV({ end: e.target.value })} /></Field>}
                <label className="check full"><input type="checkbox" checked={v.anytime} onChange={(e) => setV({ anytime: e.target.checked })} /> Anytime that day</label>
                {f.job_type === 'recurring' && (<>
                  <Field label="Repeats"><select value={v.repeat} onChange={(e) => setV({ repeat: e.target.value })}><option value="none">Doesn't repeat</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></Field>
                  {v.repeat !== 'none' && <Field label="Number of visits"><input type="number" min={1} max={104} value={v.occurrences} onChange={(e) => setV({ occurrences: e.target.value })} /></Field>}
                </>)}
                <div className="field full"><span>Assigned</span><TeamSelect value={v.assignees} onChange={(a) => setV({ assignees: a })} /></div>
                <Field label="Visit instructions" full><textarea value={v.instructions} onChange={(e) => setV({ instructions: e.target.value })} /></Field>
              </div>
            )}
          </div>
        )}
        {!id && (
          <div className="card card-pad">
            <div className="section-title">On-site checklist</div>
            <p className="small muted mb">Make sure nothing gets missed on site.</p>
            {f.checklist.map((c, i) => (
              <div className="row mt-s" key={i}><input className="input" value={c} onChange={(e) => setF({ ...f, checklist: f.checklist.map((x, j) => (j === i ? e.target.value : x)) })} />
                <button className="btn ghost icon" onClick={() => setF({ ...f, checklist: f.checklist.filter((_, j) => j !== i) })} aria-label="Remove"><X size={15} /></button></div>
            ))}
            <button className="btn sm mt-s" onClick={() => setF({ ...f, checklist: [...f.checklist, ''] })}><Plus size={14} /> Add item</button>
          </div>
        )}
        <div className="card card-pad">
          <div className="section-title">Product / Service</div>
          <LineItemsEditor items={f.items} onChange={(items) => setF({ ...f, items })} />
          <div className="mt"><TotalsEditor items={f.items} discount={0} tax_rate={0} onChange={() => {}} readOnly /></div>
        </div>
        <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => nav(-1)}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={save}>Save job</button>
        </div>
      </div>
    </div>
  );
}

/** Create or edit a visit. If no jobId is given, lets the user pick a job (used by the schedule). */
export function VisitModal({ visit, jobId, defaultStart, onClose, onSaved }) {
  const { user } = useApp();
  const office = isOffice(user);
  const [jid, setJid] = useState(jobId || visit?.job_id || '');
  const { data: jobs } = useLoad(!jobId && !visit ? '/jobs' : null);
  const [f, setF] = useState(() => visit ? { title: visit.title || '', start: toLocalInput(visit.start_at), end: toLocalInput(visit.end_at), anytime: !!visit.anytime, assignees: (visit.assignees || []).map((a) => a.id), instructions: visit.instructions || '', repeat: 'none', occurrences: 4 }
    : (() => { const s = defaultStart ? new Date(defaultStart) : new Date(`${ymd()}T09:00`); return { title: '', start: toLocalInput(s.toISOString()), end: toLocalInput(new Date(s.getTime() + 2 * 3600e3).toISOString()), anytime: false, assignees: [user.id], instructions: '', repeat: 'none', occurrences: 4 }; })());
  const [run, busy] = useAction();
  const save = () => run(async () => {
    const body = { title: f.title || undefined, start_at: fromLocalInput(f.anytime ? f.start.slice(0, 10) + 'T08:00' : f.start), end_at: fromLocalInput(f.anytime ? f.start.slice(0, 10) + 'T17:00' : f.end), anytime: f.anytime, assignees: f.assignees, instructions: f.instructions, repeat: f.repeat, occurrences: f.repeat === 'none' ? 1 : f.occurrences };
    if (visit) return api.put(`/visits/${visit.id}`, body);
    if (!jid) throw new Error('Choose a job');
    return api.post(`/jobs/${jid}/visits`, body);
  }, 'Visit saved').then(onSaved).catch(() => {});
  return (
    <Modal title={visit ? 'Edit visit' : 'Schedule a visit'} onClose={onClose} footer={<>
      {!office && <span className="muted small">Only office staff can reschedule visits.</span>}
      <button className="btn" onClick={onClose}>Cancel</button>{office && <button className="btn primary" disabled={busy} onClick={save}>Save visit</button>}</>}>
      <div className="form-grid">
        {!jobId && !visit && (
          <div className="full">
            <Field label="Job"><select value={jid} onChange={(e) => setJid(e.target.value)}><option value="">Select a job…</option>{(jobs || []).map((j) => <option key={j.id} value={j.id}>#{j.number} · {j.title} — {j.client_name}</option>)}</select></Field>
            <div className="small muted mt-s">Need a new job? <Link to={`/jobs/new?date=${f.start.slice(0, 10)}`} onClick={onClose}>Create a job</Link></div>
          </div>
        )}
        <Field label="Visit title (optional)" full><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label={f.anytime ? 'Date' : 'Start'}><input type={f.anytime ? 'date' : 'datetime-local'} value={f.anytime ? f.start.slice(0, 10) : f.start} onChange={(e) => setF({ ...f, start: f.anytime ? e.target.value + f.start.slice(10) : e.target.value })} /></Field>
        {!f.anytime && <Field label="End"><input type="datetime-local" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>}
        <label className="check full"><input type="checkbox" checked={f.anytime} onChange={(e) => setF({ ...f, anytime: e.target.checked })} /> Anytime that day</label>
        {!visit && <Field label="Repeat"><select value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })}><option value="none">Doesn't repeat</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></Field>}
        {!visit && f.repeat !== 'none' && <Field label="Number of visits"><input type="number" min={1} max={104} value={f.occurrences} onChange={(e) => setF({ ...f, occurrences: e.target.value })} /></Field>}
        <div className="field full"><span>Assigned</span><TeamSelect value={f.assignees} onChange={(a) => setF({ ...f, assignees: a })} /></div>
        <Field label="Visit instructions" full><textarea value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function JobDetail() {
  const { id } = useParams();
  const { user } = useApp();
  const office = isOffice(user);
  const { data: j, error, reload, setData } = useLoad(`/jobs/${id}`);
  const [visit, setVisit] = useState(null);
  const [del, setDel] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [run] = useAction();
  const nav = useNavigate();
  if (error) return <ErrorBox error={error} />;
  if (!j) return <Loading />;
  const act = (fn, msg) => run(fn, msg).then(reload).catch(() => {});
  const createInvoice = () => run(() => api.post('/invoices', { job_id: j.id }), 'Invoice created').then((r) => nav(`/invoices/${r.id}`)).catch(() => {});

  return (
    <div>
      <PageHead title={j.title} crumbs={<Link to="/jobs">Jobs</Link>} sub={<span className="row wrap" style={{ gap: 8 }}><Status s={j.display_status} /><span>Job #{j.number} for <Link to={`/clients/${j.client_id}`} className="strong">{j.client.name}</Link></span></span>}>
        {j.status === 'active' && <button className="btn" onClick={() => act(() => api.post(`/jobs/${j.id}/complete`), 'Job closed')}><CheckCircle2 size={15} /> Close job</button>}
        {office && j.display_status === 'requires_invoicing' && <button className="btn primary" onClick={createInvoice}><Receipt size={15} /> Create invoice</button>}
        {office && (
          <Dropdown className="btn icon" label={<MoreHorizontal size={18} />}>
            <button onClick={() => nav(`/jobs/${j.id}/edit`)}><Pencil size={15} /> Edit job</button>
            <button onClick={() => setVisit({})}><CalendarPlus size={15} /> Add visit</button>
            <button onClick={createInvoice}><Receipt size={15} /> Create invoice</button>
            {j.status !== 'active' && <button onClick={() => act(() => api.put(`/jobs/${j.id}`, { status: 'active' }), 'Job reopened')}><RotateCcw size={15} /> Reopen job</button>}
            {j.status !== 'archived' && <button onClick={() => act(() => api.put(`/jobs/${j.id}`, { status: 'archived' }), 'Job archived')}><Archive size={15} /> Archive</button>}
            {isAdmin(user) && <button className="danger" onClick={() => setDel(true)}><Trash2 size={15} /> Delete</button>}
          </Dropdown>
        )}
      </PageHead>

      <div className="grid g-main-side">
        <div className="stack">
          <div className="card card-pad">
            <dl className="kv">
              <dt>Property</dt><dd>{j.property?.address ? <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.property.address)}`}>{j.property.address}</a> : '—'}</dd>
              <dt>Contact</dt><dd>{[j.client.phone, j.client.email].filter(Boolean).join(' · ') || '—'}</dd>
              <dt>Job type</dt><dd>{j.job_type === 'recurring' ? 'Recurring' : 'One-off'}</dd>
              {j.quote && <><dt>From quote</dt><dd><Link to={`/quotes/${j.quote.id}`}>#{j.quote.number} {j.quote.title}</Link></dd></>}
              {j.certificate_no && <><dt>Certificate #</dt><dd>{j.certificate_no}</dd></>}
              {!!j.invoices.length && <><dt>Invoices</dt><dd>{j.invoices.map((i) => <Link key={i.id} to={`/invoices/${i.id}`} style={{ marginRight: 8 }}>#{i.number}</Link>)}</dd></>}
              <dt>Instructions</dt><dd className="pre">{j.instructions || '—'}</dd>
            </dl>
          </div>

          <div className="card">
            <div className="card-head"><h3>Visits</h3>{office && <button className="btn sm" onClick={() => setVisit({})}><Plus size={14} /> Add visit</button>}</div>
            <ul className="list-plain" style={{ padding: '0 20px' }}>
              {j.visits.map((v) => {
                const late = v.status === 'scheduled' && new Date(v.end_at) < new Date();
                return (
                  <li key={v.id} className="row" style={{ alignItems: 'flex-start' }}>
                    <button className="btn ghost icon" title={v.status === 'completed' ? 'Mark incomplete' : 'Mark complete'} onClick={() => act(() => api.put(`/visits/${v.id}`, { status: v.status === 'completed' ? 'scheduled' : 'completed' }), v.status === 'completed' ? 'Visit reopened' : 'Visit completed')}>
                      {v.status === 'completed' ? <CheckCircle2 size={20} color="var(--green)" /> : <Circle size={20} />}
                    </button>
                    <div style={{ flex: 1 }}>
                      <div className="strong">{date(v.start_at, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · {v.anytime ? 'Anytime' : `${time(v.start_at)} – ${time(v.end_at)}`}{late && <span className="badge red" style={{ marginLeft: 8 }}>Overdue</span>}</div>
                      <div className="small muted">{v.title}{v.instructions && ` — ${v.instructions}`}</div>
                      <div className="mt-s"><Avatars users={v.assignees} /></div>
                    </div>
                    {office && <button className="btn sm ghost" onClick={() => setVisit(v)}>Edit</button>}
                    {office && <button className="btn sm ghost" aria-label="Delete visit" onClick={() => askConfirm('Delete this visit?').then((ok) => ok && act(() => api.del(`/visits/${v.id}`), 'Visit deleted'))}><Trash2 size={14} /></button>}
                  </li>
                );
              })}
              {!j.visits.length && <li className="muted">No visits scheduled. {office && <button className="link" onClick={() => setVisit({})}>Schedule one</button>}</li>}
            </ul>
          </div>

          <div className="card">
            <div className="card-head"><h3>On-site checklist</h3><span className="muted small">{j.checklist.filter((c) => c.done).length}/{j.checklist.length} done</span></div>
            <div className="card-pad" style={{ paddingTop: 4 }}>
              <ul className="list-plain checklist">
                {j.checklist.map((c) => (
                  <li key={c.id} className={c.done ? 'done' : ''}>
                    <input type="checkbox" checked={!!c.done} onChange={(e) => { const done = e.target.checked; setData((d) => ({ ...d, checklist: d.checklist.map((x) => (x.id === c.id ? { ...x, done: done ? 1 : 0 } : x)) })); act(() => api.put(`/checklist/${c.id}`, { done })); }} aria-label={c.label} style={{ width: 17, height: 17, accentColor: 'var(--ink)' }} />
                    <span style={{ flex: 1 }}>{c.label}</span>{c.done ? <span className="small faint">{c.done_by_name}</span> : null}
                    <button className="btn ghost icon sm" aria-label="Remove" onClick={() => act(() => api.del(`/checklist/${c.id}`))}><X size={13} /></button>
                  </li>
                ))}
              </ul>
              <form className="row mt-s" onSubmit={(e) => { e.preventDefault(); if (newItem.trim()) act(() => api.post(`/jobs/${j.id}/checklist`, { label: newItem })).then(() => setNewItem('')); }}>
                <input className="input" placeholder="Add checklist item" value={newItem} onChange={(e) => setNewItem(e.target.value)} /><button className="btn">Add</button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Line items</h3>{office && <Link className="btn sm" to={`/jobs/${j.id}/edit`}>Edit</Link>}</div>
            <DocLines items={j.items} showOptional={false} />
            {office && j.totals && <div className="card-pad"><div className="totals"><div className="line grand"><span>Total (ex. {`tax`})</span><span>{money(j.totals.subtotal)}</span></div></div></div>}
          </div>
          <Attachments type="job" id={j.id} title="Photos, test results & certificates" />
        </div>

        <div className="stack">
          {office && j.labour && (
            <div className="card card-pad">
              <h3 className="mb">Job costing</h3>
              <div className="row"><span className="muted">Revenue</span><span className="spacer" /><b>{money(j.totals.subtotal)}</b></div>
              <div className="row mt-s"><span className="muted">Line item costs</span><span className="spacer" />−{money(j.totals.cost)}</div>
              <div className="row mt-s"><span className="muted">Labour ({hours(j.labour.hours)})</span><span className="spacer" />−{money(j.labour.cost)}</div>
              <div className="row mt-s"><span className="muted">Expenses</span><span className="spacer" />−{money(j.expense_total)}</div>
              <div className="row mt" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}><b>Profit</b><span className="spacer" /><b style={{ color: j.profit < 0 ? 'var(--red)' : 'var(--green)' }}>{money(j.profit)}</b></div>
              <div className="small faint right">{j.totals.subtotal ? Math.round((j.profit / j.totals.subtotal) * 100) : 0}% margin</div>
            </div>
          )}
          {!!j.expenses.length && (
            <div className="card card-pad">
              <h3 className="mb">Expenses</h3>
              {j.expenses.map((e) => <div key={e.id} className="row small mt-s"><span>{e.title}</span><span className="spacer" />{money(e.amount)}</div>)}
            </div>
          )}
          <Notes type="job" id={j.id} />
        </div>
      </div>
      {visit && <VisitModal jobId={j.id} visit={visit.id ? visit : null} onClose={() => setVisit(null)} onSaved={() => { setVisit(null); reload(); }} />}
      {del && <Confirm danger title="Delete job?" confirmLabel="Delete" onClose={() => setDel(false)} onConfirm={() => api.del(`/jobs/${j.id}`).then(() => nav('/jobs'))}>Job #{j.number}, its visits and checklist will be permanently removed.</Confirm>}
    </div>
  );
}
