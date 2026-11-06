import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Inbox, FileText, Wrench, Receipt, ChevronRight, MapPin, CalendarDays, CheckCircle2 } from 'lucide-react';
import { api } from '../api.js';
import { money, time, date, ymd } from '../format.js';
import { useApp, useLoad, isOffice, Loading, Status, Avatars, Empty, useAction } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Activity } from '../components/shared.jsx';

function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

export default function Home() {
  const { user } = useApp();
  const { data, reload } = useLoad(`/dashboard?date=${ymd()}`);
  const nav = useNavigate();
  const [run] = useAction();
  if (!data) return <Loading />;
  const office = isOffice(user);
  const a = data.appointments;
  const t = data.todo || {};
  const wf = (list, s) => list?.find((x) => x.status === s)?.c || 0;

  return (
    <div>
      <PageHead title={`${greeting()}, ${user.name.split(' ')[0]}`} sub={date(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />

      {office && (
        <div className="card mb">
          <div className="workflow">
            <div>
              <h4><Inbox size={17} /> Requests</h4>
              <Link to="/requests?status=new"><span>New</span><b>{wf(data.workflow.requests, 'new')}</b></Link>
              <Link to="/requests?status=assessment"><span>Assessments scheduled</span><b>{wf(data.workflow.requests, 'assessment')}</b></Link>
              <Link to="/requests"><span>Assessments today</span><b>{t.assessments_today}</b></Link>
            </div>
            <div>
              <h4><FileText size={17} /> Quotes</h4>
              <Link to="/quotes?status=approved"><span>Approved</span><b>{wf(data.workflow.quotes, 'approved')}</b></Link>
              <Link to="/quotes?status=draft"><span>Draft</span><b>{wf(data.workflow.quotes, 'draft')}</b></Link>
              <Link to="/quotes?status=changes_requested"><span>Changes requested</span><b>{wf(data.workflow.quotes, 'changes_requested')}</b></Link>
            </div>
            <div>
              <h4><Wrench size={17} /> Jobs</h4>
              <Link to="/jobs?status=requires_invoicing"><span>Requires invoicing</span><b>{wf(data.workflow.jobs, 'requires_invoicing')}</b></Link>
              <Link to="/jobs?status=active"><span>Active</span><b>{wf(data.workflow.jobs, 'active')}</b></Link>
              <Link to="/jobs?status=late"><span>Late / overdue visits</span><b>{wf(data.workflow.jobs, 'late')}</b></Link>
              <Link to="/jobs?status=unscheduled"><span>Unscheduled</span><b>{wf(data.workflow.jobs, 'unscheduled')}</b></Link>
            </div>
            <div>
              <h4><Receipt size={17} /> Invoices</h4>
              <Link to="/invoices?status=awaiting_payment"><span>Awaiting payment</span><b>{wf(data.workflow.invoices, 'awaiting_payment') + wf(data.workflow.invoices, 'partial')}</b></Link>
              <Link to="/invoices?status=overdue"><span>Overdue</span><b>{wf(data.workflow.invoices, 'overdue')}</b></Link>
              <Link to="/invoices?status=draft"><span>Draft</span><b>{wf(data.workflow.invoices, 'draft')}</b></Link>
            </div>
          </div>
        </div>
      )}

      <div className={office ? 'grid g-main-side' : ''}>
        <div className="card">
          <div className="card-head"><h2>Today's appointments</h2><Link to="/schedule" className="btn sm">View schedule</Link></div>
          <div className="grid g4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(96px,1fr))', gap: 0, borderBottom: '1px solid var(--border)' }}>
            {[['Total', a.total], ['Active', a.active], ['Completed', a.completed], ['Overdue', a.overdue], ['Remaining', a.remaining]].map(([l, v]) => (
              <div className="stat" key={l} style={{ padding: '12px 18px' }}><div className="label">{l}</div><div className="value" style={{ fontSize: 22 }}>{v}</div></div>
            ))}
          </div>
          {data.visits.length ? (
            <ul className="list-plain" style={{ padding: '0 20px' }}>
              {data.visits.map((v) => (
                <li key={v.id} className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ width: 70 }} className="strong">{v.anytime ? 'Anytime' : time(v.start_at)}<div className="small faint">{v.anytime ? '' : time(v.end_at)}</div></div>
                  <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => nav(`/jobs/${v.job_id}`)}>
                    <div className="strong">{v.client_name} <span className="muted" style={{ fontWeight: 500 }}>· #{v.job_number} {v.title || v.job_title}</span></div>
                    {(v.street || v.city) && <div className="small muted row" style={{ gap: 4 }}><MapPin size={12} />{[v.street, v.city].filter(Boolean).join(', ')}</div>}
                    <div className="mt-s"><Avatars users={v.assignees} /></div>
                  </div>
                  {v.status === 'completed' ? <Status s="completed" /> : (
                    <button className="btn sm" onClick={() => run(() => api.put(`/visits/${v.id}`, { status: 'completed' }), 'Visit completed').then(reload).catch(() => {})}><CheckCircle2 size={14} /> Complete</button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={CalendarDays} title="Nothing scheduled today" action={office && <Link className="btn" to="/jobs/new">Schedule a job</Link>}>
              This is where you'll get an overview of today's visits once they're scheduled.
            </Empty>
          )}
        </div>

        {office && (
          <div className="stack">
            <div className="card">
              <div className="card-head"><h2>Business performance</h2></div>
              <Link to="/invoices?status=unpaid" className="stat" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="label">Receivables <ChevronRight size={16} /></div>
                <div className="hint">{data.performance.receivables.clients} client{data.performance.receivables.clients === 1 ? '' : 's'} owe you</div>
                <div className="value">{money(data.performance.receivables.amount)}</div>
              </Link>
              <Link to="/schedule" className="stat" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="label">Upcoming jobs <ChevronRight size={16} /></div>
                <div className="hint">This week ({date(data.performance.upcoming_jobs.from, { day: 'numeric', month: 'short' })} – {date(data.performance.upcoming_jobs.to, { day: 'numeric', month: 'short' })})</div>
                <div className="value">{data.performance.upcoming_jobs.count} <span className="muted" style={{ fontSize: 15, fontWeight: 600 }}>· {money(data.performance.upcoming_jobs.value)}</span></div>
              </Link>
              <Link to="/insights" className="stat">
                <div className="label">Revenue <ChevronRight size={16} /></div>
                <div className="hint">Payments received this month so far</div>
                <div className="value">{money(data.performance.revenue_month)}</div>
              </Link>
            </div>
            <div className="card">
              <div className="card-head"><h3>Recent activity</h3></div>
              <div className="card-pad" style={{ paddingTop: 4 }}><Activity limit={8} /></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
