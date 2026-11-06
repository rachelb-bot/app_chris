import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { Home, CalendarDays, Users, Inbox, FileText, Wrench, Receipt, Megaphone, BarChart3, Wallet, Clock, Settings, Plus, Search, LogOut, Menu, Zap, User, Play, Square } from 'lucide-react';
import { api, qs } from '../api.js';
import { useApp, isOffice, Dropdown, useDebounced, useAction, Avatar, Modal, Field } from './ui.jsx';
import { hours } from '../format.js';

export function BrandMark({ size = 18 }) { return <span className="brand-mark"><Zap size={size} fill="currentColor" /></span>; }

export default function Layout({ children }) {
  const { user, settings, logout, counts } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const office = isOffice(user);
  const nav = [
    ['/', Home, 'Home', true],
    ['/schedule', CalendarDays, 'Schedule', true],
    'sep',
    ['/clients', Users, 'Clients', true],
    ['/requests', Inbox, 'Requests', office, counts?.new_requests],
    ['/quotes', FileText, 'Quotes', office],
    ['/jobs', Wrench, 'Jobs', true],
    ['/invoices', Receipt, 'Invoices', office],
    'sep',
    ['/marketing', Megaphone, 'Marketing', office],
    ['/insights', BarChart3, 'Insights', office],
    ['/expenses', Wallet, 'Expenses', true],
    ['/timesheets', Clock, 'Timesheets', true],
  ];
  return (
    <div className="shell">
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <Link to="/" className="brand"><BrandMark /><div>Voltline<small>{settings.company_name}</small></div></Link>
        {office && <div className="nav-create"><CreateMenu block /></div>}
        {nav.map((n, i) => n === 'sep' ? <div className="nav-sep" key={i} /> : n[3] && (
          <NavLink key={n[0]} to={n[0]} end={n[0] === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            {React.createElement(n[1], { size: 18 })}{n[2]}{!!n[4] && <span className="count">{n[4]}</span>}
          </NavLink>
        ))}
        <div className="sidebar-foot">
          <NavLink to="/settings" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}><Settings size={18} />Settings</NavLink>
          <button className="nav-link" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer' }} onClick={logout}><LogOut size={18} />Sign out</button>
        </div>
      </aside>
      {open && <div className="overlay" style={{ zIndex: 80, padding: 0 }} onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar no-print">
          <button className="btn ghost icon menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <GlobalSearch />
          <div className="topbar-right">
            <ClockWidget />
            <Link to="/settings/account" title={user.name}><Avatar name={user.name} color={user.color} /></Link>
          </div>
        </header>
        <main className="page">{children}</main>
      </div>
    </div>
  );
}

export function CreateMenu({ block }) {
  const nav = useNavigate();
  return (
    <Dropdown align="left" className={`btn accent${block ? ' block' : ''}`} label={<><Plus size={16} /> Create</>}>
      <button onClick={() => nav('/clients?new=1')}><Users size={16} /> Client</button>
      <button onClick={() => nav('/requests/new')}><Inbox size={16} /> Request</button>
      <button onClick={() => nav('/quotes/new')}><FileText size={16} /> Quote</button>
      <button onClick={() => nav('/jobs/new')}><Wrench size={16} /> Job</button>
      <button onClick={() => nav('/invoices/new')}><Receipt size={16} /> Invoice</button>
      <button onClick={() => nav('/expenses?new=1')}><Wallet size={16} /> Expense</button>
    </Dropdown>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [hl, setHl] = useState(0);
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q, 180);
  const input = useRef();
  const nav = useNavigate();
  useEffect(() => {
    const k = (e) => { if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); input.current?.focus(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    if (dq.trim().length < 2) { setRes([]); return; }
    api.get(`/search${qs({ q: dq })}`).then((r) => { setRes(r); setHl(0); }).catch(() => {});
  }, [dq]);
  const go = (r) => { nav(r.url); setQ(''); setOpen(false); input.current?.blur(); };
  return (
    <div className="search">
      <Search size={16} />
      <input ref={input} placeholder="Search clients, jobs, quotes, invoices…  ( / )" value={q} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, res.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
          if (e.key === 'Enter' && res[hl]) go(res[hl]);
          if (e.key === 'Escape') { setQ(''); input.current.blur(); }
        }} aria-label="Search" />
      {open && q.length >= 2 && (
        <div className="search-results">
          {res.map((r, i) => (
            <a key={r.type + r.id} href={r.url} className={i === hl ? 'hl' : ''} onMouseDown={(e) => { e.preventDefault(); go(r); }}>
              <span className="badge" style={{ textTransform: 'capitalize' }}>{r.type}</span>
              <div style={{ minWidth: 0 }}><div className="strong" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div><div className="small muted">{r.subtitle}</div></div>
            </a>
          ))}
          {!res.length && <div className="card-pad muted">No results for “{q}”</div>}
        </div>
      )}
    </div>
  );
}

/** Clock in/out for the signed-in team member; feeds Timesheets. */
function ClockWidget() {
  const [cur, setCur] = useState(undefined);
  const [now, setNow] = useState(Date.now());
  const [picking, setPicking] = useState(false);
  const [run, busy] = useAction();
  const load = () => api.get('/timesheets/current').then(setCur).catch(() => setCur(null));
  useEffect(() => { load(); const h = () => load(); window.addEventListener('vl:clock', h); return () => window.removeEventListener('vl:clock', h); }, []);
  useEffect(() => { if (!cur) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [cur]);
  if (cur === undefined) return null;
  if (cur) {
    const secs = Math.max(0, Math.floor((now - new Date(cur.start_at).getTime()) / 1000));
    const hms = [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60].map((n) => String(n).padStart(2, '0')).join(':');
    return <button className="clock-pill on" disabled={busy} title={cur.job_title ? `Job #${cur.job_number} ${cur.job_title}` : 'General time'} onClick={() => run(() => api.post('/timesheets/clock-out'), 'Clocked out').then(() => { load(); window.dispatchEvent(new Event('vl:clock')); }).catch(() => {})}><span className="pulse" />{hms}<Square size={13} fill="currentColor" /></button>;
  }
  return (<>
    <button className="clock-pill" onClick={() => setPicking(true)}><Play size={13} fill="currentColor" /> Clock in</button>
    {picking && <ClockInModal onClose={() => setPicking(false)} onDone={() => { setPicking(false); load(); window.dispatchEvent(new Event('vl:clock')); }} />}
  </>);
}

function ClockInModal({ onClose, onDone }) {
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState('');
  const [run, busy] = useAction();
  useEffect(() => { api.get('/jobs?status=all').then((j) => setJobs(j.filter((x) => !['archived', 'completed', 'requires_invoicing'].includes(x.display_status)))).catch(() => {}); }, []);
  return (
    <Modal title="Clock in" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => run(() => api.post('/timesheets/clock-in', { job_id: jobId || null }), 'Clocked in').then(onDone).catch(() => {})}>Start timer</button></>}>
      <Field label="Job (optional — used for job costing)">
        <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
          <option value="">General time (no job)</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>#{j.number} · {j.title} — {j.client_name}</option>)}
        </select>
      </Field>
    </Modal>
  );
}

export function PageHead({ title, sub, crumbs, children }) {
  return (
    <div className="page-head">
      <div>{crumbs && <div className="crumbs">{crumbs}</div>}<h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
      {children && <div className="btn-group no-print">{children}</div>}
    </div>
  );
}
export { hours, User };
