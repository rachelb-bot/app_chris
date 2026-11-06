import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, ExternalLink } from 'lucide-react';
import { api, qs } from '../api.js';
import { date, time, ymd } from '../format.js';
import { useLoad, useAction, Seg, useApp, isOffice, Avatars, Modal, Status } from '../components/ui.jsx';
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
  const eventsOn = (d) => (events || []).filter((e) => ymd(new Date(e.start_at)) === ymd(d) || (new Date(e.start_at) < d && new Date(e.end_at) > d));
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
        {office && <button className="btn primary" onClick={() => setModal({ start: new Date(`${ymd(cursor)}T09:00`).toISOString() })}><Plus size={16} /> Schedule visit</button>}
      </PageHead>
      <div className="row wrap mb">
        <div className="row" style={{ gap: 6 }}>
          <button className="btn icon" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft size={18} /></button>
          <button className="btn icon" onClick={() => step(1)} aria-label="Next"><ChevronRight size={18} /></button>
          <button className="btn" onClick={() => setCursor(new Date())}>Today</button>
        </div>
        <h2 style={{ marginLeft: 6 }}>{title}</h2>
        <span className="spacer" />
        {office && (
          <select className="input" style={{ width: 'auto' }} value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Team filter">
            <option value="">Team: All</option>{(team || []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}<option value="unassigned">Unassigned</option>
          </select>
        )}
        <Seg value={view} onChange={setView} options={[['month', 'Month'], ['week', 'Week'], ['day', 'Day']]} />
      </div>

      <div className={office && unscheduled?.length && view !== 'month' ? 'grid g-main-side' : ''} style={office && unscheduled?.length && view !== 'month' ? { gridTemplateColumns: 'minmax(0,1fr) 240px' } : undefined}>
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
        {office && !!unscheduled?.length && view !== 'month' && (
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

      {modal && <VisitModal jobId={modal.jobId} visit={modal.visit} defaultStart={modal.start} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
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
