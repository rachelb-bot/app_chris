import React, { useEffect, useState } from 'react';
import { Megaphone, Plus, Send, Trash2, Gift, Link2, Star } from 'lucide-react';
import { api, qs } from '../api.js';
import { money, date, dateTime } from '../format.js';
import { useLoad, useAction, Loading, Empty, Field, Modal, Tabs, Status, useApp, useToast, askConfirm, Seg } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import { HBars } from '../components/shared.jsx';

function CampaignModal({ campaign, preset, onClose, onSaved }) {
  const { data: stats } = useLoad('/clients/stats');
  const [f, setF] = useState(campaign || (preset ? { name: preset.name, subject: preset.subject, body: preset.body, audience: preset.audience } : { name: '', subject: '', body: 'Hi {first_name},\n\n\n\nKind regards,\n{company}', audience: 'all' }));
  const [count, setCount] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { api.get(`/campaigns/audience${qs({ audience: f.audience })}`).then((r) => setCount(r.count)).catch(() => {}); }, [f.audience]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal wide title={campaign ? 'Edit campaign' : 'New email campaign'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={() => run(() => campaign ? api.put(`/campaigns/${campaign.id}`, f) : api.post('/campaigns', f), 'Campaign saved').then(onSaved).catch(() => {})}>Save draft</button></>}>
      <div className="form-grid">
        <Field label="Campaign name (internal)"><input value={f.name} onChange={set('name')} autoFocus placeholder="e.g. Spring EV charger offer" /></Field>
        <Field label="Audience" hint={count != null ? `${count} clients with an email address` : ''}>
          <select value={f.audience} onChange={set('audience')}>
            <option value="all">All clients & leads</option><option value="active">Active clients</option><option value="leads">Leads only</option><option value="past">Past clients (no job in 12 months)</option>
            {(stats?.tags || []).map((t) => <option key={t} value={`tag:${t}`}>Tag: {t}</option>)}
          </select>
        </Field>
        <Field label="Subject line" full><input value={f.subject} onChange={set('subject')} /></Field>
        <Field label="Message" full hint="Use {first_name} and {company} to personalise."><textarea rows={10} value={f.body} onChange={set('body')} /></Field>
      </div>
    </Modal>
  );
}

const IDEAS = [
  { name: 'Periodic inspection reminder', audience: 'past', subject: 'When was your electrics last checked?',
    body: 'Hi {first_name},\n\nIt has been a while since we worked at your property. Electrical installations should be inspected regularly, and sooner for rental properties.\n\nReply to this email to book a periodic inspection and safety report at a time that suits you.\n\nKind regards,\n{company}' },
  { name: 'EV charger offer', audience: 'active', subject: 'Getting an electric car? Charge it at home',
    body: 'Hi {first_name},\n\nWe now install smart home EV chargers, including the dedicated circuit, earthing and certification.\n\nReply for a free quote.\n\nKind regards,\n{company}' },
  { name: 'Smoke & CO alarm check', audience: 'all', subject: 'Are your smoke and CO alarms working?',
    body: 'Hi {first_name},\n\nMains smoke and carbon monoxide alarms should be tested regularly and replaced every 10 years. We can test, replace and interlink them in one short visit.\n\nReply to book.\n\nKind regards,\n{company}' },
  { name: 'Winter safety', audience: 'active', subject: 'Get your electrics ready for winter',
    body: 'Hi {first_name},\n\nHeaters and extra lighting put more load on your electrics in winter. Book a quick safety check before the cold sets in.\n\nKind regards,\n{company}' },
  { name: 'Ask for a review', audience: 'active', subject: 'How did we do?',
    body: 'Hi {first_name},\n\nThank you for choosing us. If you were happy with the work, a short review would help other people find us. It only takes a minute.\n\nKind regards,\n{company}' },
];

function Campaigns() {
  const { data, reload } = useLoad('/campaigns');
  const { emailEnabled } = useApp();
  const [edit, setEdit] = useState(null);
  const [run] = useAction();
  const toast = useToast();
  if (!data) return <Loading />;
  return (
    <div>
      {!emailEnabled && <div className="notice blue mb small">Email delivery isn't configured on this server yet (SMTP settings). Campaign sends will be logged to the outbox only.</div>}
      <div className="card card-pad mb">
        <div className="row"><h3>Start here</h3><span className="muted small">Ready-made campaigns for an electrical business. Pick one, then edit it.</span><span className="spacer" /><button className="btn primary sm" onClick={() => setEdit({})}><Plus size={14} /> Use your own idea</button></div>
        <div className="grid mt" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
          {IDEAS.map((i) => <button key={i.name} className="card card-pad" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', boxShadow: 'none' }} onClick={() => setEdit({ ...i, idea: true })}><b>{i.name}</b><div className="small muted mt-s">{i.subject}</div></button>)}
        </div>
      </div>
      <div className="card">
        {data.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Campaign</th><th>Audience</th><th>Status</th><th className="num">Recipients</th><th /></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id}>
                <td><div className="strong">{c.name}</div><div className="small muted">{c.subject}</div></td>
                <td className="muted">{c.audience.replace('tag:', 'Tag: ')}</td>
                <td>{c.status === 'sent' ? <span className="badge green">Sent {date(c.sent_at)}</span> : <Status s="draft" />}</td>
                <td className="num">{c.status === 'sent' ? c.recipients : '—'}</td>
                <td className="right">
                  {c.status === 'draft' && (<div className="btn-group" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn sm" onClick={() => setEdit(c)}>Edit</button>
                    <button className="btn sm primary" onClick={() => askConfirm(`Send "${c.name}" now?`).then((ok) => ok && run(() => api.post(`/campaigns/${c.id}/send`)).then((r) => { toast(`Sent to ${r.recipients - r.failed} clients`); reload(); }).catch(() => {}))}><Send size={13} /> Send</button>
                    <button className="btn sm ghost" aria-label="Delete" onClick={() => askConfirm('Delete campaign?').then((ok) => ok && run(() => api.del(`/campaigns/${c.id}`)).then(reload))}><Trash2 size={13} /></button>
                  </div>)}
                </td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty icon={Megaphone} title="Boost your revenue with campaigns" action={<button className="btn primary" onClick={() => setEdit({})}>Create a campaign</button>}>Re-engage past clients, upsell services like EV chargers or surge protection, or announce a change — straight from your client list.</Empty>}
      </div>
      {edit && <CampaignModal campaign={edit.id ? edit : null} preset={edit.idea ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function Referrals() {
  const { data, reload } = useLoad('/referrals');
  const { data: clients } = useLoad('/clients?status=all');
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Loading />;
  return (
    <div>
      <div className="grid g3 mb">
        <div className="card stat"><div className="label">Referrals</div><div className="value">{data.length}</div></div>
        <div className="card stat"><div className="label">Pending rewards</div><div className="value">{data.filter((r) => r.status === 'pending').length}</div></div>
        <div className="card stat"><div className="label">Rewarded</div><div className="value">{data.filter((r) => r.status === 'rewarded').length}</div></div>
      </div>
      <div className="row mb"><p className="muted">Happy customers are your best marketers — record who referred whom and reward them.</p><span className="spacer" /><button className="btn primary" onClick={() => setF({ referrer_client_id: '', referred_client_id: '', reward: '€25 credit on next job' })}><Plus size={16} /> Record referral</button></div>
      <div className="card">
        {data.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Referred by</th><th>New client</th><th>Reward</th><th>Status</th><th>Date</th><th /></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id}><td className="strong">{r.referrer_name}</td><td>{r.referred_name}</td><td>{r.reward}</td><td><Status s={r.status} /></td><td className="muted">{date(r.created_at)}</td>
                <td className="right">{r.status === 'pending' && <button className="btn sm" onClick={() => run(() => api.put(`/referrals/${r.id}`, { status: 'rewarded' }), 'Marked rewarded').then(reload)}>Mark rewarded</button>}</td></tr>))}
            </tbody>
          </table></div>
        ) : <Empty icon={Gift} title="No referrals yet">Referrals convert better than any other lead source. Start recording them here.</Empty>}
      </div>
      {f && (
        <Modal title="Record referral" onClose={() => setF(null)} footer={<><button className="btn" onClick={() => setF(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => run(() => api.post('/referrals', f), 'Referral saved').then(() => { setF(null); reload(); }).catch(() => {})}>Save</button></>}>
          <div className="stack">
            <Field label="Referred by"><select value={f.referrer_client_id} onChange={(e) => setF({ ...f, referrer_client_id: e.target.value })}><option value="">Select…</option>{(clients || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="New client"><select value={f.referred_client_id} onChange={(e) => setF({ ...f, referred_client_id: e.target.value })}><option value="">Select…</option>{(clients || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Reward"><input value={f.reward} onChange={(e) => setF({ ...f, reward: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Performance() {
  const { data } = useLoad('/insights?from=' + new Date(Date.now() - 89 * 864e5).toISOString().slice(0, 10));
  const [metric, setMetric] = useState('leads');
  const toast = useToast();
  if (!data) return <Loading />;
  const booking = `${location.origin}/hub/book`;
  return (
    <div className="grid g2">
      <div className="card card-pad">
        <div className="row"><div><h2>Top performing sources</h2><div className="muted small mb">{metric === 'leads' ? 'New leads' : 'Revenue received'}, past 90 days</div></div><span className="spacer" /><Seg value={metric} onChange={setMetric} options={[['leads', 'Leads'], ['revenue', 'Revenue']]} /></div>
        {metric === 'leads'
          ? (data.sources.length ? <HBars data={data.sources.map((s) => ({ label: s.source, value: s.c }))} /> : <p className="muted">No leads yet. Set a lead source on each client to see what's working.</p>)
          : (data.revenueBySource.length ? <HBars data={data.revenueBySource} format={(v) => money(v, { compact: true })} /> : <p className="muted">No payments in the past 90 days.</p>)}
      </div>
      <div className="card card-pad">
        <h2>Online booking form</h2>
        <p className="muted mt-s">Put this link on your website, Google Business Profile, social bios and van signage QR code. Every submission lands in Requests and creates a lead.</p>
        <div className="row mt"><input className="input" readOnly value={booking} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => { navigator.clipboard?.writeText(booking); toast('Link copied'); }}><Link2 size={15} /> Copy</button></div>
        <a className="btn mt" href={booking} target="_blank" rel="noreferrer">Preview form</a>
      </div>
      <div className="card card-pad">
        <h2>Lead funnel</h2><div className="muted small mb">Past 90 days</div>
        <HBars data={data.conversion.funnel} />
      </div>
      <div className="card card-pad">
        <h2>Quick wins</h2>
        <ul className="list-plain mt-s">
          <li><Star size={14} /> Ask every happy client for a Google review when you close the job.</li>
          <li><Star size={14} /> Send a campaign to past clients about periodic inspections (EICR) — easy recurring work.</li>
          <li><Star size={14} /> Offer surge protection and smoke/CO detectors as optional items on panel upgrade quotes.</li>
        </ul>
      </div>
    </div>
  );
}

export default function Marketing() {
  const [tab, setTab] = useState('performance');
  return (
    <div>
      <PageHead title="Marketing" sub="Win more work from the clients you already have." />
      <Tabs value={tab} onChange={setTab} tabs={[['performance', 'Performance'], ['campaigns', 'Email campaigns'], ['referrals', 'Referrals']]} />
      {tab === 'performance' && <Performance />}
      {tab === 'campaigns' && <Campaigns />}
      {tab === 'referrals' && <Referrals />}
    </div>
  );
}
