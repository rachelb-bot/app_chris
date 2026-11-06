import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { money, date, ymd } from '../format.js';
import { useLoad, Loading, Delta, Field, Chips } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import { BarChart, HBars } from '../components/shared.jsx';

const presets = () => {
  const t = new Date();
  const som = new Date(t.getFullYear(), t.getMonth(), 1);
  const lm = new Date(t.getFullYear(), t.getMonth() - 1, 1), lme = new Date(t.getFullYear(), t.getMonth(), 0);
  return {
    month: { from: ymd(som), to: ymd(t) },
    last_month: { from: ymd(lm), to: ymd(lme) },
    d90: { from: ymd(new Date(t.getTime() - 89 * 864e5)), to: ymd(t) },
    ytd: { from: `${t.getFullYear()}-01-01`, to: ymd(t) },
  };
};

export default function Insights() {
  const [preset, setPreset] = useState('month');
  const [range, setRange] = useState(presets().month);
  const { data: d } = useLoad(`/insights${qs(range)}`);
  const nav = useNavigate();
  const pick = (p) => { setPreset(p); if (p !== 'custom') setRange(presets()[p]); };
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  return (
    <div>
      <PageHead title="Insights" sub="How the business is performing — leads, work won, revenue, profit and cash." />
      <div className="row wrap mb">
        <Chips value={preset} onChange={pick} options={[['month', 'This month'], ['last_month', 'Last month'], ['d90', 'Last 90 days'], ['ytd', 'Year to date'], ['custom', 'Custom']]} />
        {preset === 'custom' && (<>
          <Field label="From"><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="To"><input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        </>)}
      </div>
      {!d ? <Loading /> : (
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Overview</h2><span className="muted small">{date(d.from)} – {date(d.to)} · compared with previous period</span></div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 0 }}>
              {[['New leads', d.overview.new_leads], ['New requests', d.overview.new_requests], ['Converted quotes', d.overview.converted_quotes], ['New one-off jobs', d.overview.new_one_off_jobs], ['New recurring jobs', d.overview.new_recurring_jobs], ['Invoiced value', d.overview.invoiced_value, true]].map(([l, v, m]) => (
                <div className="stat" key={l} style={{ borderRight: '1px solid var(--border)' }}><div className="label">{l}</div><div className="value" style={{ fontSize: 22 }}>{m ? money(v.value, { compact: true }) : v.value}<Delta value={v.value} previous={v.previous} /></div></div>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <div className="row"><h2>Revenue</h2><span className="muted small">Payments received, last 12 months</span><span className="spacer" /><b>{money(d.revenue.reduce((s, r) => s + r.amount, 0))}</b></div>
            <BarChart data={d.revenue} label={(r) => date(r.month + '-01', { month: 'short' })} value={(r) => r.amount} highlightLast />
          </div>

          <div className="grid g2">
            <div className="card card-pad">
              <h2>Scheduled job value</h2><div className="muted small">Next 4 weeks, by week</div>
              <BarChart data={d.jobs.scheduled} label={(w) => date(w.week, { day: 'numeric', month: 'short' })} value={(w) => w.value} />
            </div>
            <div className="card card-pad">
              <h2>Job mix</h2><div className="muted small">Value of jobs created in period</div>
              <div className="mt">
                {(() => { const tot = d.jobs.mix.one_off + d.jobs.mix.recurring; return (<>
                  <div style={{ display: 'flex', height: 18, borderRadius: 6, overflow: 'hidden', background: 'var(--surface-2)' }}>
                    <div style={{ width: `${pct(d.jobs.mix.one_off, tot)}%`, background: 'var(--ink-3)' }} /><div style={{ width: `${pct(d.jobs.mix.recurring, tot)}%`, background: 'var(--amber)' }} />
                  </div>
                  <div className="row mt"><span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--ink-3)' }} />One-off</span><span className="spacer" /><b>{money(d.jobs.mix.one_off)}</b></div>
                  <div className="row mt-s"><span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--amber)' }} />Recurring</span><span className="spacer" /><b>{money(d.jobs.mix.recurring)}</b></div>
                  <div className="row mt" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}><span className="muted">Average job value</span><span className="spacer" />{d.jobs.avg.one_off != null ? money(d.jobs.avg.one_off) : '—'} one-off · {d.jobs.avg.recurring != null ? money(d.jobs.avg.recurring) : '—'} recurring</div>
                </>); })()}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Profit and loss</h2><span className="muted small">Recent one-off jobs · labour from timesheets, costs from line items + expenses</span></div>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Client</th><th>Job #</th><th className="num">Total price</th><th className="num">Labour cost</th><th className="num">Expenses</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
              <tbody>
                {d.pl.map((j) => (
                  <tr key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}><td className="strong">{j.client_name}</td><td>#{j.number}</td><td className="num">{money(j.total)}</td><td className="num">{money(j.labour)}</td><td className="num">{money(j.expenses)}</td>
                    <td className="num strong" style={{ color: j.profit < 0 ? 'var(--red)' : undefined }}>{money(j.profit)}</td><td className="num">{j.margin}%</td></tr>
                ))}
                {!d.pl.length && <tr><td colSpan={7} className="muted">No recent jobs to display.</td></tr>}
              </tbody>
            </table></div>
          </div>

          <div>
            <h2 className="mb">Cashflow</h2>
            <div className="grid g4">
              <div className="card stat"><div className="label">Receivables</div><div className="value">{money(d.cashflow.receivables.amount)}</div><div className="hint">{d.cashflow.receivables.clients} clients owe you</div></div>
              <div className="card stat"><div className="label">Projected income</div><div className="value">{money(d.cashflow.due_today)}</div><div className="hint">Due today or overdue</div><div className="strong mt-s">{money(d.cashflow.due_7)}</div><div className="hint">Due in the next 7 days</div></div>
              <div className="card stat"><div className="label">Invoice payment time</div><div className="value">{d.cashflow.payment_time_commercial ?? '—'} <span className="small muted">days</span></div><div className="hint">Commercial · past 30 days</div><div className="strong mt-s">{d.cashflow.payment_time_residential ?? '—'} days</div><div className="hint">Residential</div></div>
              <div className="card stat"><div className="label">Lead conversion time</div><div className="value">{d.conversion.lead_conversion_days ?? '—'} <span className="small muted">days</span></div><div className="hint">Lead → job (90 days)</div><div className="strong mt-s">{d.conversion.quote_approval_days ?? '—'} days</div><div className="hint">Quote approval time (30 days)</div></div>
            </div>
          </div>

          <div className="grid g2">
            <div className="card card-pad">
              <h2>Lead funnel</h2><div className="muted small mb">Past 90 days</div>
              <HBars data={d.conversion.funnel} />
              <div className="small muted mt">Conversion rate: <b>{pct(d.conversion.funnel[2].value, d.conversion.funnel[0].value)}%</b> of new leads became jobs.</div>
            </div>
            <div className="card card-pad">
              <h2>Top lead sources</h2><div className="muted small mb">New clients, past 90 days</div>
              {d.sources.length ? <HBars data={d.sources.map((s) => ({ label: s.source, value: s.c }))} /> : <p className="muted">No new clients yet.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
