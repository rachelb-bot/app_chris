import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, ExternalLink, Search, Route, CalendarX2 } from 'lucide-react';
import { api, qs } from '../api.js';
import { date, time, ymd } from '../format.js';
import { useLoad, useAction, Seg, useApp, isOffice, Avatars, Modal, Status, Field } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import { VisitModal } from './Jobs.jsx';

const START_H = 6, END_H = 21, HOUR_PX = 56;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -d.getDay());
const sameDay = (a, b) => ymd(a) === ymd(b);

export default function Schedule() {
  const { user } = useApp();
  const office = isOffice(user);
  const [view, setView] = useState(() => (window.innerWidth < 760 ? 'day' : 'week'));
  const [cursor, setCursor] = useState(new Date());
  const [userId, setUserId] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [finding, setFinding] = useState(false);
  const [showUnsched, setShowUnsched] = useState(true);
  const [modal, setModal] = useState(null);
  const [peek, setPeek] = useState(null);
  const { data: team } = useLoad('/users');
  const { data: unscheduled, reload: reloadUnsched } = useLoad(office ? '/schedule/unscheduled' : null);

  const days = useMemo(() => {
    if (view === 'day') return [new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())];
    if (view === 'week') { const s = startOfWeek(cursor); return [...Array(7)].map((_, i) => addDays(s, i)); }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const s = startOfWeek(first);
    return [...Array(42)].map((_, i) => addDays(s, i));
  }, [view, cursor]);
  const from = ymd(addDays(days[0], -1)), to = ymd(addDays(days[days.length - 1], 1));
  const { data: events, reload } = useLoad(`/schedule${qs({ from, to, user_id: userId })}`);
  const [run] = useAction();
  const nav = useNavigate();

  const step = (dir) => setCursor((c) => view === 'day' ? addDays(c, dir) : view === 'week' ? addDays(c, 7 * dir) : new Date(c.getFullYear(), c.getMonth() + dir, 1));
  const title = view === 'month' ? date(cursor, { month: 'long', year: 'numeric' }) : view === 'week' ? `${date(days[0], { day: 'numeric', month: 'short' })} – ${date(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}` : date(cursor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const nowIso = new Date().toISOString();
  const eventStatus = (e) => (e.kind === 'assessment' ? (e.end_at < nowIso ? 'overdue' : 'scheduled') : e.status === 'completed' ? 'completed' : e.end_at < nowIso ? 'overdue' : 'scheduled');
  const visible = (events || []).filter((e) => (!type || e.kind === type) && (!status || eventStatus(e) === status));
  const eventsOn = (d) => visible.filter((e) => ymd(new Date(e.start_at)) === ymd(d) || (new Date(e.start_at) < d && new Date(e.end_at) > d));
  const routeUrl = (() => {
    const stops = eventsOn(cursor).filter((e) => e.street || e.city).sort((a, b) => a.start_at.localeCompare(b.start_at)).map((e) => [e.street, e.city, e.postcode].filter(Boolean).join(', '));
    return stops.length ? `https://www.google.com/maps/dir/${stops.map(encodeURIComponent).join('/')}` : null;
  })();
  const refresh = () => { reload(); reloadUnsched(); };

  const onDrop = (e, day, hour) => {
    e.preventDefault();
    const data = JSON.parse(e.dataTransfer.getData('text/plain') || '{}');
    if (!data.id) return;
    if (data.kind === 'job') { setModal({ jobId: data.id, start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour ?? 9).toISOString() }); return; }
    if (data.kind !== 'visit') return;
    const dur = new Date(data.end_at) - new Date(data.start_at);
    const s = new Date(data.start_at);
    const ns = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour ?? s.getHours(), hour != null ? 0 : s.getMinutes());
    run(() => api.put(`/visits/${data.id}`, { start_at: ns.toISOString(), end_at: new Date(ns.getTime() + dur).toISOString() }), 'Visit rescheduled').then(refresh).catch(() => {});
  };
  const dragProps = (e) => office && e.kind === 'visit' ? { draggable: true, onDragStart: (ev) => ev.dataTransfer.setData('text/plain', JSON.stringify(e)) } : {};
  const openEvent = (e) => setPeek(e);

  return (
    <div>
      <PageHead title="Schedule">
        {office && <button className="btn accent" onClick={() => setFinding(true)}><Search size={15} /> Find a time</button>}
        {office && <button className="btn primary" onClick={() => setModal({ start: new Date(`${ymd(cursor)}T09:00`).toISOString() })}><Plus size={16} /> Schedule visit</button>}
      </PageHead>
      <div className="row wrap mb">
        <div className="row" style={{ gap: 6 }}>
          <button className="btn icon" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft size={18} /></button>
          <button className="btn icon" onClick={() => step(1)} aria-label="Next"><ChevronRight size={18} /></button>
          <button className="btn" onClick={() => setCursor(new Date())}>Today</button>
        </div>
        <h2 style={{ marginLeft: 6 }}>{title}</h2>
        <input type="month" className="input" style={{ width: 'auto' }} aria-label="Jump to month" value={ymd(cursor).slice(0, 7)} onChange={(e) => e.target.value && setCursor(new Date(e.target.value + '-01T12:00'))} />
        <span className="spacer" />
        {office && (
          <select className="input" style={{ width: 'auto' }} value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Team filter">
            <option value="">Team: All</option>{(team || []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}<option value="unassigned">Unassigned</option>
          </select>
        )}
        <select className="input" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Type filter">
          <option value="">Type: All</option><option value="visit">Visits</option><option value="assessment">Assessments</option>
        </select>
        <select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="">Status: All</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="overdue">Overdue</option>
        </select>
        {office && <button className="btn" title="Unscheduled jobs" onClick={() => setShowUnsched((v) => !v)}><CalendarX2 size={15} /> {unscheduled?.length || 0}</button>}
        {view === 'day' && routeUrl && <a className="btn" href={routeUrl} target="_blank" rel="noreferrer" title="Open today's stops in Google Maps"><Route size={15} /> Route</a>}
        <Seg value={view} onChange={setView} options={[['month', 'Month'], ['week', 'Week'], ['day', 'Day']]} />
      </div>

      <div className={office && showUnsched && unscheduled?.length && view !== 'month' ? 'grid g-main-side' : ''} style={office && showUnsched && unscheduled?.length && view !== 'month' ? { gridTemplateColumns: 'minmax(0,1fr) 240px' } : undefined}>
        {view === 'month' ? (
          <div className="month">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div className="dow" key={d}>{d}</div>)}
            {days.map((d) => {
              const evs = eventsOn(d);
              return (
                <div key={ymd(d)} className={`day${d.getMonth() !== cursor.getMonth() ? ' other' : ''}${sameDay(d, new Date()) ? ' today' : ''}`}
                  onClick={() => { setCursor(d); setView('day'); }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, d)}>
                  <span className="n">{d.getDate()}</span>
                  {evs.slice(0, 4).map((e) => <div key={e.kind + e.id} className="chip-event" {...dragProps(e)} style={{ borderLeftColor: e.assignees?.[0]?.color || 'var(--blue)', background: e.kind === 'assessment' ? 'var(--purple-bg)' : undefined, opacity: e.status === 'completed' ? 0.55 : 1 }}
                    onClick={(ev) => { ev.stopPropagation(); openEvent(e); }}>{e.anytime ? '' : time(e.start_at) + ' '}{e.client_name}</div>)}
                  {evs.length > 4 && <span className="small muted">+{evs.length - 4} more</span>}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="cal">
            <div className="cal-head" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
              <div />{days.map((d) => <div key={ymd(d)} className={sameDay(d, new Date()) ? 'today' : ''}><span>{date(d, { weekday: 'short' })} {d.getDate()}</span></div>)}
            </div>
            <div className="anytime-row" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
              <div className="small faint" style={{ justifyContent: 'center', alignItems: 'flex-end' }}>Anytime</div>
              {days.map((d) => <div key={ymd(d)}>{eventsOn(d).filter((e) => e.anytime).map((e) => <div key={e.id} className="chip-event" {...dragProps(e)} onClick={() => openEvent(e)} style={{ borderLeftColor: e.assignees?.[0]?.color || 'var(--blue)' }}>{e.client_name}</div>)}</div>)}
            </div>
            <div className="cal-body" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
              <div className="cal-times">{[...Array(END_H - START_H)].map((_, i) => <div key={i}>{String(START_H + i).padStart(2, '0')}:00</div>)}</div>
              {days.map((d) => (
                <div key={ymd(d)} className="cal-col" onDragOver={(e) => e.preventDefault()}>
                  {[...Array((END_H - START_H) * 2)].map((_, i) => {
                    const h = START_H + Math.floor(i / 2), m = (i % 2) * 30;
                    return <div key={i} className="cal-slot" onDrop={(e) => onDrop(e, d, h)} onClick={() => office && setModal({ start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString() })} />;
                  })}
                  {eventsOn(d).filter((e) => !e.anytime).map((e) => {
                    const s = new Date(e.start_at), en = new Date(e.end_at);
                    const startMin = sameDay(s, d) ? s.getHours() * 60 + s.getMinutes() : START_H * 60;
                    const endMin = sameDay(en, d) ? en.getHours() * 60 + en.getMinutes() : END_H * 60;
                    const top = Math.max(0, ((startMin - START_H * 60) / 60) * HOUR_PX);
                    const height = Math.max(24, ((Math.min(endMin, END_H * 60) - Math.max(startMin, START_H * 60)) / 60) * HOUR_PX - 2);
                    const color = e.assignees?.[0]?.color || 'var(--blue)';
                    return (
                      <div key={e.kind + e.id} className={`event${e.status === 'completed' ? ' done' : ''}${e.kind === 'assessment' ? ' assessment' : ''}`} style={{ top, height, borderLeftColor: color }} {...dragProps(e)} onClick={() => openEvent(e)} title={`${e.client_name} — ${e.title || e.job_title}`}>
                        <b>{e.client_name}</b>
                        <div>{time(e.start_at)} · {e.kind === 'assessment' ? 'Assessment' : `#${e.job_number}`}</div>
                        {height > 60 && <div className="faint">{e.title || e.job_title}</div>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
        {office && showUnsched && !!unscheduled?.length && view !== 'month' && (
          <div className="card">
            <div className="card-head"><h3>Unscheduled jobs</h3></div>
            <div className="card-pad" style={{ paddingTop: 8 }}>
              <p className="small muted mb">Drag onto the calendar or click to schedule.</p>
              {unscheduled.map((j) => (
                <div key={j.id} className="chip-event" style={{ marginBottom: 6, padding: '7px 8px', whiteSpace: 'normal' }} draggable onDragStart={(ev) => ev.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'job', id: j.id }))} onClick={() => setModal({ jobId: j.id, start: new Date(`${ymd(cursor)}T09:00`).toISOString() })}>
                  <b>{j.client_name}</b><div className="small">#{j.number} {j.title}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {modal && <VisitModal jobId={modal.jobId} visit={modal.visit} defaultStart={modal.start} defaultHours={modal.hours} defaultAssignees={modal.assignees} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
      {finding && <FindATime team={(team || []).filter((u) => u.active)} onClose={() => setFinding(false)} onPick={(slot) => { setFinding(false); setModal({ start: slot.start.toISOString(), hours: slot.hours, assignees: [slot.user.id] }); }} />}
      {peek && (
        <Modal title={peek.kind === 'assessment' ? 'Assessment' : `Visit · Job #${peek.job_number}`} onClose={() => setPeek(null)} footer={<>
          {peek.kind === 'visit' && peek.status !== 'completed' && <button className="btn" onClick={() => run(() => api.put(`/visits/${peek.id}`, { status: 'completed' }), 'Visit completed').then(() => { setPeek(null); refresh(); }).catch(() => {})}>Mark complete</button>}
          {peek.kind === 'visit' && office && <button className="btn" onClick={() => { setModal({ visit: peek }); setPeek(null); }}>Edit / reschedule</button>}
          <button className="btn primary" onClick={() => nav(peek.kind === 'assessment' ? `/requests/${peek.id}` : `/jobs/${peek.job_id}`)}><ExternalLink size={15} /> Open {peek.kind === 'assessment' ? 'request' : 'job'}</button>
        </>}>
          <div className="strong" style={{ fontSize: 16 }}>{peek.client_name}</div>
          <div className="muted">{peek.title || peek.job_title}</div>
          <dl className="kv mt">
            <dt>When</dt><dd>{date(peek.start_at, { weekday: 'short', day: 'numeric', month: 'short' })} · {peek.anytime ? 'Anytime' : `${time(peek.start_at)} – ${time(peek.end_at)}`}</dd>
            {(peek.street || peek.city) && <><dt>Where</dt><dd>{[peek.street, peek.city].filter(Boolean).join(', ')}</dd></>}
            <dt>Team</dt><dd><Avatars users={peek.assignees} /></dd>
            {peek.status && <><dt>Status</dt><dd><Status s={peek.status} /></dd></>}
            {peek.instructions && <><dt>Instructions</dt><dd className="pre">{peek.instructions}</dd></>}
          </dl>
        </Modal>
      )}
    </div>
  );
}

/** Finds the next free slots of a given length for each team member, inside working hours. */
function FindATime({ team, onClose, onPick }) {
  const { settings } = useApp();
  const [hours, setHours] = useState(2);
  const [who, setWho] = useState('');
  const [from, setFrom] = useState(ymd());
  const [slots, setSlots] = useState(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    setBusy(true);
    try {
      const to = ymd(addDays(new Date(from + 'T12:00'), 21));
      const evs = await api.get(`/schedule${qs({ from, to })}`);
      const workdays = String(settings.workdays || '1,2,3,4,5').split(',').map(Number);
      const [sh, sm] = String(settings.workday_start || '08:00').split(':').map(Number);
      const [eh, em] = String(settings.workday_end || '17:00').split(':').map(Number);
      const people = who ? team.filter((u) => String(u.id) === String(who)) : team.filter((u) => u.role === 'tech').length ? team.filter((u) => u.role === 'tech') : team;
      const out = [];
      const now = Date.now();
      for (let i = 0; i <= 21 && out.length < 8; i++) {
        const day = addDays(new Date(from + 'T12:00'), i);
        if (!workdays.includes(day.getDay())) continue;
        const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm).getTime();
        const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), eh, em).getTime();
        for (const u of people) {
          const busyBlocks = evs.filter((e) => e.status !== 'completed' && e.assignees?.some((a) => a.id === u.id)).map((e) => [new Date(e.start_at).getTime(), new Date(e.end_at).getTime()]);
          for (let t = dayStart; t + hours * 3600e3 <= dayEnd; t += 30 * 60e3) {
            if (t < now) continue;
            const end = t + hours * 3600e3;
            if (busyBlocks.every(([a, b]) => end <= a || t >= b)) { out.push({ start: new Date(t), hours, user: u }); break; }
          }
          if (out.length >= 8) break;
        }
      }
      setSlots(out);
    } finally { setBusy(false); }
  };
  return (
    <Modal title="Find a time" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={busy} onClick={search}><Search size={15} /> Find free slots</button></>}>
      <div className="form-grid">
        <Field label="Job length"><select value={hours} onChange={(e) => setHours(Number(e.target.value))}>{[1, 1.5, 2, 3, 4, 6, 8].map((h) => <option key={h} value={h}>{h} hour{h === 1 ? '' : 's'}</option>)}</select></Field>
        <Field label="Who"><select value={who} onChange={(e) => setWho(e.target.value)}><option value="">Any electrician</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <div className="small muted" style={{ alignSelf: 'end' }}>Working hours {settings.workday_start || '08:00'}–{settings.workday_end || '17:00'} (Settings → Company)</div>
      </div>
      {slots && (
        <ul className="list-plain mt">
          {slots.map((s, i) => (
            <li key={i} className="row">
              <div style={{ flex: 1 }}><b>{date(s.start, { weekday: 'short', day: 'numeric', month: 'short' })} · {time(s.start)}–{time(new Date(s.start.getTime() + s.hours * 3600e3))}</b><div className="small muted">{s.user.name}</div></div>
              <button className="btn sm primary" onClick={() => onPick(s)}>Book</button>
            </li>
          ))}
          {!slots.length && <li className="muted">No free slots in the next 3 weeks for that length. Try a shorter visit or another person.</li>}
        </ul>
      )}
    </Modal>
  );
}
