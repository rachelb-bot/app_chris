import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, Briefcase, Phone, Mail, CalendarClock, FileText, Wrench, Inbox, Trash2, AlertTriangle } from 'lucide-react';
import { api, qs } from '../api.js';
import { money, date, ymd } from '../format.js';
import { useLoad, useAction, Loading, Field, Modal, useDebounced, Avatar, askConfirm } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import { ClientPicker, Notes } from '../components/shared.jsx';

const SOURCES = ['Google', 'Referral', 'Facebook', 'Instagram', 'Website', 'Online booking', 'Phone', 'Repeat client', 'Van signage', 'Other'];

function DealModal({ deal, stages, onClose, onSaved }) {
  const { data: team } = useLoad('/users');
  const [f, setF] = useState(() => deal?.id ? { ...deal } : { title: '', client_id: null, value: '', owner_id: '', source: '', stage: deal?.stage || 'new', expected_close: '', next_step: '', next_step_at: '', lost_reason: '' });
  const [run, busy] = useAction();
  const nav = useNavigate();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => run(async () => {
    const body = { ...f, owner_id: f.owner_id || null, value: Number(f.value) || 0 };
    if (deal?.id) await api.put(`/deals/${deal.id}`, body); else await api.post('/deals', body);
  }, deal?.id ? 'Opportunity saved' : 'Opportunity added').then(onSaved).catch(() => {});
  const remove = () => askConfirm('Delete this opportunity? Linked requests, quotes and jobs are kept.', { confirmLabel: 'Delete' })
    .then((ok) => ok && run(() => api.del(`/deals/${deal.id}`), 'Opportunity deleted').then(onSaved).catch(() => {}));
  const quoteUrl = `/quotes/new?client_id=${f.client_id || ''}${deal?.request_id ? `&request_id=${deal.request_id}` : ''}`;

  return (
    <Modal wide title={deal?.id ? f.title || 'Opportunity' : 'New opportunity'} onClose={onClose} footer={<>
      {deal?.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={remove}><Trash2 size={15} /> Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={save}>Save</button>
    </>}>
      <div className="form-grid">
        <Field label="Opportunity" full><input value={f.title} onChange={set('title')} autoFocus placeholder="e.g. Office LED lighting retrofit" /></Field>
        <div className="full">
          <div className="field"><span>Client</span></div>
          <div className="mt-s"><ClientPicker value={f.client_id} onChange={(id) => setF({ ...f, client_id: id })} /></div>
        </div>
        <Field label="Estimated value"><input type="number" step="0.01" value={f.value} onChange={set('value')} /></Field>
        <Field label="Stage"><select value={f.stage} onChange={set('stage')}>{stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
        <Field label="Owner"><select value={f.owner_id || ''} onChange={set('owner_id')}><option value="">Unassigned</option>{(team || []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Lead source"><select value={f.source || ''} onChange={set('source')}><option value="">—</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Next step" full><input value={f.next_step || ''} onChange={set('next_step')} placeholder="e.g. Call back with revised price" /></Field>
        <Field label="Next step due"><input type="date" value={f.next_step_at || ''} onChange={set('next_step_at')} /></Field>
        <Field label="Expected to close"><input type="date" value={f.expected_close || ''} onChange={set('expected_close')} /></Field>
        {f.stage === 'lost' && <Field label="Why was it lost?" full><input value={f.lost_reason || ''} onChange={set('lost_reason')} placeholder="e.g. Price, timing, went with another contractor" /></Field>}
      </div>
      {deal?.id && (
        <>
          <div className="btn-group mt">
            {deal.request && <Link className="btn sm" to={`/requests/${deal.request.id}`} onClick={onClose}><Inbox size={14} /> Request</Link>}
            {deal.quote ? <Link className="btn sm" to={`/quotes/${deal.quote.id}`} onClick={onClose}><FileText size={14} /> Quote #{deal.quote.number}</Link>
              : <button className="btn sm" disabled={!f.client_id} onClick={() => { onClose(); nav(quoteUrl); }}><FileText size={14} /> Create quote</button>}
            {deal.job && <Link className="btn sm" to={`/jobs/${deal.job.id}`} onClick={onClose}><Wrench size={14} /> Job #{deal.job.number}</Link>}
            {deal.client_phone && <span className="tag row" style={{ gap: 6, margin: 0 }}><Phone size={13} />{deal.client_phone}</span>}
            {deal.client_email && <span className="tag row" style={{ gap: 6, margin: 0 }}><Mail size={13} />{deal.client_email}</span>}
          </div>
          <div className="mt"><Notes type="deal" id={deal.id} /></div>
        </>
      )}
    </Modal>
  );
}

function DealCard({ d, onOpen, onDragStart }) {
  const overdue = d.next_step_at && d.next_step_at < ymd() && !['won', 'lost'].includes(d.stage);
  const stale = d.days_in_stage >= 7 && !['won', 'lost'].includes(d.stage);
  return (
    <div className="deal" draggable onDragStart={onDragStart} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 6 }}>
        <b className="deal-title">{d.title}</b>
        {d.owner && <Avatar sm name={d.owner.name} color={d.owner.color} />}
      </div>
      <div className="small muted">{d.client_name}</div>
      <div className="row mt-s" style={{ gap: 6, flexWrap: 'wrap' }}>
        <b className="small">{d.value ? money(d.value, { compact: true }) : '—'}</b>
        {d.quote && <span className="badge" title="Linked quote">Q#{d.quote.number}</span>}
        {stale && <span className="badge amber" title="No movement for a week or more">{d.days_in_stage}d in stage</span>}
      </div>
      {d.stage === 'lost' && d.lost_reason && <div className="small muted mt-s">{d.lost_reason}</div>}
      {d.next_step && !['won', 'lost'].includes(d.stage) && (
        <div className={`small mt-s row ${overdue ? 'overdue' : 'muted'}`} style={{ gap: 5 }}>
          {overdue ? <AlertTriangle size={12} /> : <CalendarClock size={12} />}{d.next_step}{d.next_step_at ? ` · ${date(d.next_step_at, { day: 'numeric', month: 'short' })}` : ''}
        </div>
      )}
    </div>
  );
}

export default function Pipeline() {
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const dq = useDebounced(q);
  const { data, reload, setData } = useLoad(`/pipeline${qs({ q: dq, owner_id: owner })}`);
  const { data: team } = useLoad('/users');
  const [open, setOpen] = useState(null);
  const [over, setOver] = useState(null);
  const [run] = useAction();

  const columns = useMemo(() => (data ? data.stages.map((s) => ({ ...s, deals: data.deals.filter((d) => d.stage === s.key) })) : []), [data]);
  if (!data) return <Loading />;

  const drop = (stage) => (e) => {
    e.preventDefault(); setOver(null);
    const id = Number(e.dataTransfer.getData('text/deal'));
    const d = data.deals.find((x) => x.id === id);
    if (!d || d.stage === stage) return;
    setData((cur) => ({ ...cur, deals: cur.deals.map((x) => (x.id === id ? { ...x, stage, days_in_stage: 0 } : x)) }));
    const label = data.stages.find((s) => s.key === stage).label;
    run(() => api.put(`/deals/${id}`, { stage }), `Moved to ${label}`).then(() => { reload(); if (stage === 'lost') setOpen({ ...d, stage }); }).catch(reload);
  };
  const s = data.summary;

  return (
    <div>
      <PageHead title="Pipeline" sub="Every sales opportunity from first enquiry to won or lost. Deals move along automatically as you book assessments, send quotes and win work; drag a card to move it yourself.">
        <button className="btn primary" onClick={() => setOpen({ stage: 'new' })}><Plus size={16} /> New opportunity</button>
      </PageHead>
      <div className="grid g4 mb">
        <div className="card stat"><div className="label">Open pipeline</div><div className="value">{money(s.open_value, { compact: true })}</div><div className="hint">{s.open_count} open opportunities</div></div>
        <div className="card stat"><div className="label">Won</div><div className="value">{money(s.won_90, { compact: true })}</div><div className="hint">{s.won_count_90} deals · past 90 days</div></div>
        <div className="card stat"><div className="label">Win rate</div><div className="value">{s.win_rate_90 == null ? '—' : `${s.win_rate_90}%`}</div><div className="hint">Won vs lost · past 90 days</div></div>
        <div className="card stat"><div className="label">Needs attention</div><div className="value" style={{ color: s.stale ? 'var(--amber-t)' : undefined }}>{s.stale}</div><div className="hint">No movement for 7+ days</div></div>
      </div>
      <div className="row wrap mb">
        <div className="search" style={{ maxWidth: 280 }}><Search size={16} /><input placeholder="Search opportunities…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input" style={{ width: 'auto' }} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner filter">
          <option value="">Owner: All</option>{(team || []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
      {!data.deals.length && !dq && !owner ? (
        <div className="card"><div className="empty"><div className="icon"><Briefcase size={24} /></div><h3>Don't let good jobs slip away</h3><p>Opportunities appear here automatically when requests come in or quotes are sent. You can also add one yourself.</p><button className="btn primary" onClick={() => setOpen({ stage: 'new' })}>Add an opportunity</button></div></div>
      ) : (
        <div className="board">
          {columns.map((c) => (
            <section key={c.key} className={`board-col${over === c.key ? ' over' : ''} col-${c.key}`} onDragOver={(e) => { e.preventDefault(); setOver(c.key); }} onDragLeave={() => setOver(null)} onDrop={drop(c.key)} aria-label={c.label}>
              <header>
                <div className="row"><b>{c.label}</b><span className="count-pill">{c.deals.length}</span></div>
                <div className="small muted">{money(c.deals.reduce((a, d) => a + d.value, 0), { compact: true })}</div>
              </header>
              <div className="board-cards">
                {c.deals.map((d) => <DealCard key={d.id} d={d} onOpen={() => setOpen(d)} onDragStart={(e) => e.dataTransfer.setData('text/deal', String(d.id))} />)}
                {!c.deals.length && <div className="small faint board-empty">Drop here</div>}
                {c.key === 'new' && <button className="btn ghost sm" onClick={() => setOpen({ stage: 'new' })}><Plus size={14} /> Add</button>}
              </div>
            </section>
          ))}
        </div>
      )}
      <p className="small faint mt">Won and lost deals stay on the board for 60 days.</p>
      {open && <DealModal deal={open} stages={data.stages} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} />}
    </div>
  );
}
