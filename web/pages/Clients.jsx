import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Users, Plus, MoreHorizontal, Pencil, Trash2, MapPin, Mail, Phone, Archive, GitMerge, Search, Upload, Download, ArrowUpDown } from 'lucide-react';
import { api, qs } from '../api.js';
import { money, date, ago, ymd, IS_DEMO } from '../format.js';
import { useLoad, useAction, Loading, ErrorBox, Status, Empty, Modal, Field, Dropdown, Chips, Confirm, useDebounced, useApp, isOffice, isAdmin, Delta, useToast } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import { ClientFormModal, Notes, Attachments, Activity } from '../components/shared.jsx';

export function ClientsList() {
  const { user } = useApp();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('leads_active');
  const [tag, setTag] = useState('');
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useLoad(`/clients${qs({ q: dq, status, tag })}`);
  const { data: stats, reload: reloadStats } = useLoad('/clients/stats');
  const [merge, setMerge] = useState(false);
  const nav = useNavigate();
  const creating = params.get('new') === '1';
  const [importing, setImporting] = useState(false);
  const [sort, setSort] = useState({ key: 'activity', dir: -1 });
  const sorted = data ? [...data].sort((a, b) => sort.key === 'name' ? sort.dir * a.name.localeCompare(b.name) : sort.dir * String(a.last_activity || '').localeCompare(String(b.last_activity || ''))) : data;
  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === 'name' ? 1 : -1 }));
  const exportCsv = async () => {
    const rows = await api.get('/clients?status=all');
    const head = ['First name', 'Last name', 'Company', 'Email', 'Phone', 'Address', 'Type', 'Status', 'Tags', 'Lead source', 'Created'];
    const body = rows.map((c) => [c.first_name, c.last_name, c.company_name, c.email, c.phone, c.address, c.client_type, c.status, c.tags.join('; '), c.lead_source, c.created_at]);
    const csv = [head, ...body].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `clients-${ymd()}.csv`; a.click();
  };

  return (
    <div>
      <PageHead title="Clients">
        {isOffice(user) && <button className="btn primary" onClick={() => setParams({ new: '1' })}><Plus size={16} /> New client</button>}
        {isOffice(user) && (
          <Dropdown label={<><MoreHorizontal size={16} /> More actions</>}>
            <button onClick={() => setImporting(true)}><Upload size={15} /> Import clients (CSV)</button>
            {!IS_DEMO && <button onClick={exportCsv}><Download size={15} /> Export clients (CSV)</button>}
            {isAdmin(user) && <button onClick={() => setMerge(true)}><GitMerge size={15} /> Merge duplicates</button>}
          </Dropdown>
        )}
      </PageHead>
      {stats && (
        <div className="grid g3 mb">
          <div className="card stat"><div className="label">New leads</div><div className="hint">Past 30 days</div><div className="value">{stats.new_leads_30}<Delta value={stats.new_leads_30} previous={stats.new_leads_prev_30} /></div></div>
          <div className="card stat"><div className="label">New clients</div><div className="hint">Past 30 days</div><div className="value">{stats.new_clients_30}</div></div>
          <div className="card stat"><div className="label">Total new clients</div><div className="hint">Year to date</div><div className="value">{stats.total_new_ytd}</div></div>
        </div>
      )}
      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="row wrap">
            <Chips value={status} onChange={setStatus} options={[['leads_active', 'Leads & active'], ['lead', 'Leads'], ['active', 'Active'], ['archived', 'Archived'], ['all', 'All']]} />
            {!!stats?.tags?.length && (
              <select className="input" style={{ width: 'auto' }} value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
                <option value="">Filter by tag</option>{stats.tags.map((t) => <option key={t}>{t}</option>)}
              </select>
            )}
          </div>
          <div className="search" style={{ maxWidth: 280 }}><Search size={16} /><input placeholder="Search clients…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {error ? <div className="card-pad"><ErrorBox error={error} /></div> : loading && !data ? <Loading /> : data.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th><button className="link row" style={{ color: 'inherit', gap: 4 }} onClick={() => sortBy('name')}>Name <ArrowUpDown size={12} /></button></th>
                <th className="hide-sm">Address</th><th className="hide-sm">Tags</th><th>Status</th>
                <th className="hide-sm"><button className="link row" style={{ color: 'inherit', gap: 4 }} onClick={() => sortBy('activity')}>Last activity <ArrowUpDown size={12} /></button></th>
              </tr></thead>
              <tbody>
                {sorted.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => nav(`/clients/${c.id}`)}>
                    <td><div className="strong">{c.name}</div><div className="small muted">{c.email || c.phone}</div></td>
                    <td className="hide-sm muted">{c.address || '—'}</td>
                    <td className="hide-sm">{c.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</td>
                    <td><Status s={c.status} /></td>
                    <td className="hide-sm muted">{ago(c.last_activity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={Users} title="No clients found">Add your first client, or create a request and the client is created for you.</Empty>}
      </div>
      {creating && <ClientFormModal onClose={() => setParams({})} onSaved={(id) => nav(`/clients/${id}`)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload(); reloadStats(); }} />}
      {merge && <MergeModal onClose={() => setMerge(false)} onDone={() => { setMerge(false); reload(); reloadStats(); }} />}
    </div>
  );
}

// ---------- CSV import ----------
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';' && !text.slice(0, 2000).includes(',')) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
const HEADER_MAP = {
  first_name: ['firstname', 'first', 'givenname', 'forename'], last_name: ['lastname', 'last', 'surname', 'familyname'],
  company_name: ['company', 'companyname', 'business', 'organisation', 'organization'], email: ['email', 'emailaddress', 'mail'],
  phone: ['phone', 'mobile', 'phonenumber', 'telephone', 'tel', 'cell'], street: ['street', 'address', 'address1', 'streetaddress', 'addressline1'],
  city: ['city', 'town'], region: ['region', 'county', 'state', 'province'], postcode: ['postcode', 'zip', 'zipcode', 'eircode', 'postalcode'],
  country: ['country'], tags: ['tags', 'tag', 'labels'], lead_source: ['leadsource', 'source', 'howheard'], client_type: ['type', 'clienttype'],
  status: ['status'], notes: ['notes', 'note', 'comments'], name: ['name', 'fullname', 'clientname', 'contactname'],
};
function mapRows(rows) {
  const [head, ...rest] = rows;
  const cols = head.map((h) => { const k = h.toLowerCase().replace(/[^a-z0-9]/g, ''); return Object.keys(HEADER_MAP).find((f) => HEADER_MAP[f].includes(k)) || null; });
  return { cols, records: rest.map((r) => {
    const o = {};
    cols.forEach((c, i) => { if (c && r[i] != null && String(r[i]).trim()) o[c] = String(r[i]).trim(); });
    if (o.name && !o.first_name && !o.last_name) { const parts = o.name.split(/\s+/); o.first_name = parts.shift(); o.last_name = parts.join(' '); }
    delete o.name;
    return o;
  }) };
}

function ImportModal({ onClose, onDone }) {
  const [parsed, setParsed] = useState(null);
  const [run, busy] = useAction();
  const toast = useToast();
  const read = (file) => file && file.text().then((t) => setParsed(mapRows(parseCsv(t)))).catch(() => toast('Could not read that file', 'error'));
  const matched = parsed ? [...new Set(parsed.cols.filter(Boolean))] : [];
  return (
    <Modal wide title="Import clients from a spreadsheet" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !parsed?.records.length} onClick={() => run(() => api.post('/clients/import', { rows: parsed.records })).then((r) => { toast(`Imported ${r.created} clients${r.duplicates ? ` · ${r.duplicates} already existed` : ''}${r.skipped ? ` · ${r.skipped} skipped (no name)` : ''}`); onDone(); }).catch(() => {})}>
        Import {parsed?.records.length || ''} clients</button></>}>
      <p className="muted mb">Upload a CSV saved from Excel, Google Sheets or your old system. The first row must be column headings such as <b>First name, Last name, Company, Email, Phone, Address, Town, County, Eircode, Tags, Lead source</b>. Clients whose email already exists are skipped.</p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => read(e.target.files[0])} />
      {parsed && (
        <div className="mt">
          <div className="notice blue small">Found <b>{parsed.records.length}</b> rows. Matched columns: {matched.length ? matched.map((m) => m.replace('_', ' ')).join(', ') : 'none: check the heading row'}.</div>
          <div className="table-wrap mt-s"><table className="table">
            <thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th>Address</th></tr></thead>
            <tbody>{parsed.records.slice(0, 5).map((r, i) => <tr key={i}><td>{[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}</td><td>{r.company_name || ''}</td><td>{r.email || ''}</td><td>{r.phone || ''}</td><td>{[r.street, r.city].filter(Boolean).join(', ')}</td></tr>)}</tbody>
          </table></div>
          {parsed.records.length > 5 && <div className="small muted mt-s">…and {parsed.records.length - 5} more</div>}
        </div>
      )}
    </Modal>
  );
}

function MergeModal({ onClose, onDone, keepId }) {
  const { data } = useLoad('/clients?status=all');
  const [keep, setKeep] = useState(keepId || '');
  const [dup, setDup] = useState('');
  const [run, busy] = useAction();
  return (
    <Modal title="Merge duplicate clients" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !keep || !dup || keep === dup} onClick={() => run(() => api.post(`/clients/${keep}/merge`, { duplicate_id: dup }), 'Clients merged').then(onDone).catch(() => {})}>Merge</button></>}>
      <p className="muted mb">All properties, requests, quotes, jobs, invoices, notes and files from the duplicate move to the client you keep. The duplicate is then removed.</p>
      <div className="stack">
        <Field label="Keep this client"><select value={keep} onChange={(e) => setKeep(e.target.value)}><option value="">Select…</option>{(data || []).map((c) => <option key={c.id} value={c.id}>{c.name} {c.email ? `(${c.email})` : ''}</option>)}</select></Field>
        <Field label="Merge in (and remove) this duplicate"><select value={dup} onChange={(e) => setDup(e.target.value)}><option value="">Select…</option>{(data || []).filter((c) => String(c.id) !== String(keep)).map((c) => <option key={c.id} value={c.id}>{c.name} {c.email ? `(${c.email})` : ''}</option>)}</select></Field>
      </div>
    </Modal>
  );
}

function PropertyModal({ clientId, property, onClose, onSaved }) {
  const [f, setF] = useState(property || { street: '', city: '', region: '', postcode: '', country: '', notes: '' });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={property ? 'Edit property' : 'Add property'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={() => run(() => property ? api.put(`/properties/${property.id}`, f) : api.post(`/clients/${clientId}/properties`, f), 'Property saved').then(onSaved).catch(() => {})}>Save</button></>}>
      <div className="form-grid">
        <Field label="Street" full><input value={f.street || ''} onChange={set('street')} autoFocus /></Field>
        <Field label="City / Town"><input value={f.city || ''} onChange={set('city')} /></Field>
        <Field label="County / Region"><input value={f.region || ''} onChange={set('region')} /></Field>
        <Field label="Postcode / Eircode"><input value={f.postcode || ''} onChange={set('postcode')} /></Field>
        <Field label="Country"><input value={f.country || ''} onChange={set('country')} /></Field>
        <Field label="Property notes (access, board location, MPRN…)" full><textarea value={f.notes || ''} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

export function ClientDetail() {
  const { id } = useParams();
  const { user } = useApp();
  const office = isOffice(user);
  const { data: c, error, reload } = useLoad(`/clients/${id}`);
  const [edit, setEdit] = useState(false);
  const [prop, setProp] = useState(null);
  const [del, setDel] = useState(false);
  const [tab, setTab] = useState('work');
  const [run] = useAction();
  const nav = useNavigate();
  useEffect(() => setTab('work'), [id]);
  if (error) return <ErrorBox error={error} />;
  if (!c) return <Loading />;

  return (
    <div>
      <PageHead title={c.name} crumbs={<Link to="/clients">Clients</Link>} sub={<span className="row" style={{ gap: 8 }}><Status s={c.status} /><span className="badge">{c.client_type}</span>{c.tags.map((t) => <span className="tag" key={t} style={{ margin: 0 }}>{t}</span>)}</span>}>
        {office && (<>
          <Link className="btn" to={`/requests/new?client_id=${c.id}`}>New request</Link>
          <Link className="btn" to={`/quotes/new?client_id=${c.id}`}>New quote</Link>
          <Link className="btn primary" to={`/jobs/new?client_id=${c.id}`}>New job</Link>
          <Dropdown className="btn icon" label={<MoreHorizontal size={18} />}>
            <button onClick={() => setEdit(true)}><Pencil size={15} /> Edit client</button>
            <button onClick={() => nav(`/invoices/new?client_id=${c.id}`)}><Plus size={15} /> New invoice</button>
            {c.status !== 'archived' ? <button onClick={() => run(() => api.put(`/clients/${c.id}`, { status: 'archived' }), 'Client archived').then(reload)}><Archive size={15} /> Archive</button>
              : <button onClick={() => run(() => api.put(`/clients/${c.id}`, { status: 'active' }), 'Client restored').then(reload)}><Archive size={15} /> Restore</button>}
            {isAdmin(user) && <button className="danger" onClick={() => setDel(true)}><Trash2 size={15} /> Delete</button>}
          </Dropdown>
        </>)}
      </PageHead>

      <div className="grid g-main-side">
        <div className="stack">
          <div className="card">
            <div className="card-head"><h3>Properties</h3>{office && <button className="btn sm" onClick={() => setProp({})}><Plus size={14} /> Add property</button>}</div>
            <ul className="list-plain" style={{ padding: '0 20px' }}>
              {c.properties.map((p) => (
                <li key={p.id} className="row">
                  <MapPin size={16} className="faint" />
                  <div style={{ flex: 1 }}><div>{p.address || 'No address'}</div>{p.notes && <div className="small muted pre">{p.notes}</div>}</div>
                  <a className="btn sm ghost" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}`}>Map</a>
                  {office && <button className="btn sm ghost" onClick={() => setProp(p)}>Edit</button>}
                </li>
              ))}
              {!c.properties.length && <li className="muted">No properties yet.</li>}
            </ul>
          </div>

          <div className="card">
            <div className="tabs" style={{ padding: '0 12px', marginBottom: 0 }}>
              {[['work', 'Overview'], ...(office ? [['billing', 'Billing history']] : []), ['activity', 'Activity'], ['visits', 'Upcoming visits']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
            </div>
            {tab === 'work' && (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Item</th><th>Status</th><th className="hide-sm">Date</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {[
                      ...c.requests.map((r) => ({ k: 'r' + r.id, url: `/requests/${r.id}`, label: `Request · ${r.title}`, status: r.status, date: r.created_at })),
                      ...c.quotes.map((q) => ({ k: 'q' + q.id, url: `/quotes/${q.id}`, label: `Quote #${q.number} · ${q.title}`, status: q.status, date: q.created_at, amount: q.total })),
                      ...c.jobs.map((j) => ({ k: 'j' + j.id, url: `/jobs/${j.id}`, label: `Job #${j.number} · ${j.title}`, status: j.display_status, date: j.created_at, amount: j.subtotal })),
                      ...c.invoices.map((i) => ({ k: 'i' + i.id, url: `/invoices/${i.id}`, label: `Invoice #${i.number} · ${i.subject}`, status: i.display_status, date: i.issue_date, amount: i.total })),
                    ].filter((x) => office || x.k[0] === 'j').sort((a, b) => String(b.date).localeCompare(String(a.date))).map((x) => (
                      <tr key={x.k} className="clickable" onClick={() => nav(x.url)}><td className="strong">{x.label}</td><td><Status s={x.status} /></td><td className="hide-sm muted">{date(x.date)}</td><td className="num">{x.amount != null && office ? money(x.amount) : ''}</td></tr>
                    ))}
                    {!c.requests.length && !c.quotes.length && !c.jobs.length && !c.invoices.length && <tr><td colSpan={4} className="muted">No work yet for this client.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            {tab === 'billing' && (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th>Status</th><th className="num">Total</th><th className="num">Balance</th></tr></thead>
                  <tbody>
                    {c.invoices.map((i) => <tr key={i.id} className="clickable" onClick={() => nav(`/invoices/${i.id}`)}><td className="strong">#{i.number}</td><td>{date(i.issue_date)}</td><td>{date(i.due_date)}</td><td><Status s={i.display_status} /></td><td className="num">{money(i.total)}</td><td className="num strong">{money(i.balance)}</td></tr>)}
                    {!c.invoices.length && <tr><td colSpan={6} className="muted">No invoices yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            {tab === 'activity' && <div className="card-pad"><Activity clientId={c.id} limit={50} /></div>}
            {tab === 'visits' && (
              <ul className="list-plain" style={{ padding: '0 20px' }}>
                {c.upcoming_visits.map((v) => <li key={v.id}><Link to={`/jobs/${v.job_id}`} className="strong" style={{ textDecoration: 'none' }}>{date(v.start_at, { weekday: 'short', day: 'numeric', month: 'short' })} · {v.title || v.job_title}</Link><div className="small muted">Job #{v.job_number}</div></li>)}
                {!c.upcoming_visits.length && <li className="muted">No upcoming visits.</li>}
              </ul>
            )}
          </div>
          <Attachments type="client" id={c.id} />
        </div>

        <div className="stack">
          <div className="card card-pad">
            <h3 className="mb">Contact</h3>
            <dl className="kv">
              <dt>Email</dt><dd>{c.email ? <a href={`mailto:${c.email}`} className="row" style={{ gap: 6 }}><Mail size={14} />{c.email}</a> : '—'}</dd>
              <dt>Phone</dt><dd>{c.phone ? <a href={`tel:${c.phone}`} className="row" style={{ gap: 6 }}><Phone size={14} />{c.phone}</a> : '—'}</dd>
              <dt>Lead source</dt><dd>{c.lead_source || '—'}</dd>
              <dt>Client since</dt><dd>{date(c.created_at)}</dd>
            </dl>
            {c.notes && <p className="pre muted mt small">{c.notes}</p>}
          </div>
          {office && (
            <div className="card card-pad">
              <div className="row"><span className="muted">Current balance</span><span className="spacer" /><b style={{ fontSize: 18, color: c.balance > 0 ? 'var(--red)' : undefined }}>{money(c.balance)}</b></div>
              <div className="row mt-s"><span className="muted">Lifetime paid</span><span className="spacer" /><b>{money(c.lifetime_value)}</b></div>
            </div>
          )}
          <Notes type="client" id={c.id} />
        </div>
      </div>

      {edit && <ClientFormModal client={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
      {prop && <PropertyModal clientId={c.id} property={prop.id ? prop : null} onClose={() => setProp(null)} onSaved={() => { setProp(null); reload(); }} />}
      {del && <Confirm danger title="Delete client?" confirmLabel="Delete permanently" onClose={() => setDel(false)} onConfirm={() => api.del(`/clients/${c.id}`).then(() => nav('/clients'))}>
        This permanently removes {c.name} and all of their requests, quotes, jobs and draft invoices. This can't be undone. Archiving is usually better.
      </Confirm>}
    </div>
  );
}
