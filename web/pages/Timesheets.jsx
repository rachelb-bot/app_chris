import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Check, Trash2 } from 'lucide-react';
import { api, qs } from '../api.js';
import { money, date, time, hours, ymd, toLocalInput, fromLocalInput } from '../format.js';
import { useLoad, useAction, Loading, Empty, Field, Modal, Tabs, Seg, useApp, isOffice, Avatar } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function EntryModal({ entry, onClose, onSaved }) {
  const { user } = useApp();
  const office = isOffice(user);
  const { data: team } = useLoad(office ? '/users' : null);
  const { data: jobs } = useLoad('/jobs?status=all');
  const [f, setF] = useState(() => entry ? { ...entry, start_at: toLocalInput(entry.start_at), end_at: toLocalInput(entry.end_at) } : { user_id: user.id, job_id: '', start_at: `${ymd()}T08:00`, end_at: `${ymd()}T16:30`, notes: '' });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => run(() => {
    const body = { ...f, job_id: f.job_id || null, start_at: fromLocalInput(f.start_at), end_at: fromLocalInput(f.end_at) };
    return entry ? api.put(`/timesheets/${entry.id}`, body) : api.post('/timesheets', body);
  }, 'Time saved').then(onSaved).catch(() => {});
  return (
    <Modal title={entry ? 'Edit time entry' : 'Add time'} onClose={onClose} footer={<>
      {entry && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => confirm('Delete this entry?') && run(() => api.del(`/timesheets/${entry.id}`), 'Deleted').then(onSaved).catch(() => {})}><Trash2 size={15} /> Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="form-grid">
        {office && !entry && <Field label="Team member" full><select value={f.user_id} onChange={set('user_id')}>{(team || []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>}
        <Field label="Start"><input type="datetime-local" value={f.start_at} onChange={set('start_at')} /></Field>
        <Field label="End"><input type="datetime-local" value={f.end_at || ''} onChange={set('end_at')} /></Field>
        <Field label="Job" full><select value={f.job_id || ''} onChange={set('job_id')}><option value="">General time</option>{(jobs || []).map((j) => <option key={j.id} value={j.id}>#{j.number} · {j.title} — {j.client_name}</option>)}</select></Field>
        <Field label="Notes" full><textarea value={f.notes || ''} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

function Entries() {
  const { user } = useApp();
  const office = isOffice(user);
  const [mode, setMode] = useState('day');
  const [cursor, setCursor] = useState(new Date());
  const [userId, setUserId] = useState('');
  const [edit, setEdit] = useState(null);
  const start = mode === 'day' ? cursor : addDays(cursor, -cursor.getDay());
  const end = mode === 'day' ? cursor : addDays(start, 6);
  const { data: team } = useLoad(office ? '/users' : null);
  const { data, reload } = useLoad(`/timesheets${qs({ from: ymd(start), to: ymd(end), user_id: userId })}`);
  const { data: active, reload: reloadActive } = useLoad(office ? '/timesheets/active' : null);
  useEffect(() => { const h = () => { reload(); reloadActive(); }; window.addEventListener('vl:clock', h); return () => window.removeEventListener('vl:clock', h); }, [reload, reloadActive]);
  const groups = Object.values((data || []).reduce((a, t) => { (a[t.user_id] ||= { user: { id: t.user_id, name: t.user_name, color: t.color }, entries: [] }).entries.push(t); return a; }, {}));

  return (
    <div>
      {office && !!active?.length && (
        <div className="notice green mb">On the clock now: {active.map((a) => `${a.user_name}${a.job_number ? ` (#${a.job_number})` : ''}`).join(', ')}</div>
      )}
      <div className="row wrap mb">
        <button className="btn icon" onClick={() => setCursor(addDays(cursor, mode === 'day' ? -1 : -7))} aria-label="Previous"><ChevronLeft size={18} /></button>
        <div className="strong" style={{ minWidth: 200, textAlign: 'center' }}>{mode === 'day' ? date(cursor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : `${date(start)} – ${date(end)}`}</div>
        <button className="btn icon" onClick={() => setCursor(addDays(cursor, mode === 'day' ? 1 : 7))} aria-label="Next"><ChevronRight size={18} /></button>
        <button className="btn" onClick={() => setCursor(new Date())}>Today</button>
        <Seg value={mode} onChange={setMode} options={[['day', 'Day'], ['week', 'Week']]} />
        <span className="spacer" />
        {office && <select className="input" style={{ width: 'auto' }} value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Team: All</option>{(team || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
        <button className="btn primary" onClick={() => setEdit({})}><Plus size={16} /> Add time</button>
      </div>
      {!data ? <Loading /> : groups.length ? groups.map((g) => (
        <div className="card" key={g.user.id}>
          <div className="card-head"><div className="row"><Avatar name={g.user.name} color={g.user.color} /><b>{g.user.name}</b></div><b>{hours(g.entries.reduce((s, t) => s + t.hours, 0))}</b></div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Date</th><th>Time</th><th>Job</th><th className="hide-sm">Notes</th><th>Status</th><th className="num">Hours</th></tr></thead>
            <tbody>{g.entries.map((t) => (
              <tr key={t.id} className="clickable" onClick={() => (office || !t.approved) && t.end_at && setEdit(t)}>
                <td>{date(t.start_at, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                <td>{time(t.start_at)} – {t.end_at ? time(t.end_at) : <span className="badge green">Running</span>}</td>
                <td className="muted">{t.job_number ? `#${t.job_number} ${t.job_title}` : 'General'}</td>
                <td className="hide-sm muted">{t.notes}</td>
                <td>{t.approved ? <span className="badge green">Approved</span> : <span className="badge">Pending</span>}</td>
                <td className="num strong">{hours(t.hours)}</td>
              </tr>))}
            </tbody>
          </table></div>
        </div>
      )) : <div className="card"><Empty title="No time tracked">Clock in from the top bar, or add time manually. Crew time feeds job costing and payroll.</Empty></div>}
      {edit && <EntryModal entry={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function Approve() {
  const { data, reload } = useLoad(`/timesheets${qs({ from: ymd(addDays(new Date(), -60)), to: ymd(), approved: '0' })}`);
  const [sel, setSel] = useState([]);
  const [run, busy] = useAction();
  if (!data) return <Loading />;
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <div className="card">
      <div className="card-head"><span className="muted">{data.length} entries awaiting approval (last 60 days)</span>
        <div className="btn-group"><button className="btn sm" onClick={() => setSel(sel.length === data.length ? [] : data.map((t) => t.id))}>{sel.length === data.length ? 'Clear' : 'Select all'}</button>
          <button className="btn sm primary" disabled={!sel.length || busy} onClick={() => run(() => api.post('/timesheets/approve', { ids: sel }), `${sel.length} entries approved`).then(() => { setSel([]); reload(); }).catch(() => {})}><Check size={14} /> Approve selected</button></div></div>
      {data.length ? (
        <div className="table-wrap"><table className="table">
          <thead><tr><th /><th>Team member</th><th>Date</th><th>Time</th><th>Job</th><th className="num">Hours</th></tr></thead>
          <tbody>{data.map((t) => (
            <tr key={t.id} className="clickable" onClick={() => toggle(t.id)}>
              <td><input type="checkbox" checked={sel.includes(t.id)} readOnly style={{ accentColor: 'var(--ink)' }} /></td>
              <td className="strong">{t.user_name}</td><td>{date(t.start_at)}</td><td>{time(t.start_at)} – {time(t.end_at)}</td><td className="muted">{t.job_number ? `#${t.job_number} ${t.job_title}` : 'General'}</td><td className="num strong">{hours(t.hours)}</td>
            </tr>))}
          </tbody>
        </table></div>
      ) : <Empty title="All caught up">No timesheets waiting for approval.</Empty>}
    </div>
  );
}

function Payroll() {
  const [range, setRange] = useState({ from: ymd(addDays(new Date(), -13)), to: ymd() });
  const { data } = useLoad(`/payroll${qs(range)}`);
  const [run] = useAction();
  return (
    <div>
      <div className="row wrap mb">
        <Field label="Pay period from"><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="To"><input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
      </div>
      {!data ? <Loading /> : (
        <div className="card">
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Team member</th><th className="num">Approved hours</th><th className="num">Pending hours</th><th className="num">Hourly cost</th><th className="num">Gross pay (approved)</th><th className="num">Reimbursements</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}><td><div className="row"><Avatar sm name={r.name} color={r.color} /><b>{r.name}</b></div></td><td className="num">{hours(r.approved_hours)}</td><td className="num muted">{hours(r.pending_hours)}</td><td className="num">{money(r.hourly_cost)}</td><td className="num strong">{money(r.gross)}</td><td className="num">{money(r.reimbursements)}</td></tr>
              ))}
              <tr><td className="strong">Total</td><td className="num strong">{hours(data.rows.reduce((s, r) => s + r.approved_hours, 0))}</td><td className="num">{hours(data.rows.reduce((s, r) => s + r.pending_hours, 0))}</td><td /><td className="num strong">{money(data.rows.reduce((s, r) => s + r.gross, 0))}</td><td className="num strong">{money(data.rows.reduce((s, r) => s + r.reimbursements, 0))}</td></tr>
            </tbody>
          </table></div>
          <div className="card-pad small muted">Hourly cost is set per team member in Settings → Team. Pending hours must be approved before they count toward pay.
            <button className="btn sm" style={{ marginLeft: 10 }} onClick={() => run(async () => {
              const rows = [['Team member', 'Approved hours', 'Pending hours', 'Hourly cost', 'Gross', 'Reimbursements'], ...data.rows.map((r) => [r.name, r.approved_hours.toFixed(2), r.pending_hours.toFixed(2), r.hourly_cost, r.gross, r.reimbursements])];
              const blob = new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `payroll-${data.from}-to-${data.to}.csv`; a.click();
            })}>Export CSV</button></div>
        </div>
      )}
    </div>
  );
}

export default function Timesheets() {
  const { user } = useApp();
  const [tab, setTab] = useState('entries');
  const office = isOffice(user);
  return (
    <div>
      <PageHead title="Timesheets" sub="Crew clock in and out so time is captured when work starts and stops." />
      {office && <Tabs value={tab} onChange={setTab} tabs={[['entries', 'Timesheets'], ['approve', 'Approve timesheets'], ['payroll', 'Confirm payroll']]} />}
      {tab === 'entries' && <Entries />}
      {tab === 'approve' && office && <Approve />}
      {tab === 'payroll' && office && <Payroll />}
    </div>
  );
}
