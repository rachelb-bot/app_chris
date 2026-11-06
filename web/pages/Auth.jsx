import React, { useState } from 'react';
import { api } from '../api.js';
import { IS_DEMO } from '../format.js';
import { Field, useAction } from '../components/ui.jsx';
import { BrandMark } from '../components/Layout.jsx';

export function Login({ onDone, companyName }) {
  const [f, setF] = useState(IS_DEMO ? { email: 'demo@voltline.app', password: 'demo1234' } : { email: '', password: '' });
  const [run, busy] = useAction();
  const submit = (e) => { e.preventDefault(); run(() => api.post('/auth/login', f)).then(onDone).catch(() => {}); };
  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><BrandMark /><div>Voltline<small style={{ color: 'var(--muted)' }}>{companyName}</small></div></div>
        <h2 style={{ marginBottom: 18 }}>Sign in</h2>
        <div className="stack">
          <Field label="Email"><input type="email" autoComplete="username" required autoFocus value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Password"><input type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <button className="btn primary block" disabled={busy}>Sign in</button>
        </div>
        {IS_DEMO && (
          <div className="notice blue mt small">
            <b>Preview logins</b> (password <b>demo1234</b> for all):<br />
            demo@voltline.app — owner, sees everything<br />
            aoife@brightspark.example — office<br />
            liam@brightspark.example — electrician
          </div>
        )}
        <p className="small muted mt">Forgotten your password? Ask your account owner to reset it in Settings → Team.</p>
      </form>
    </div>
  );
}

export function Setup({ onDone }) {
  const [f, setF] = useState({ company_name: '', name: '', email: '', password: '' });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => { e.preventDefault(); run(() => api.post('/auth/setup', f), 'Welcome aboard!').then(onDone).catch(() => {}); };
  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><BrandMark /><div>Voltline</div></div>
        <h2>Set up your company</h2>
        <p className="muted mt-s" style={{ marginBottom: 18 }}>One place for every client, quote, job, invoice and hour worked. You'll be the account owner.</p>
        <div className="stack">
          <Field label="Company name"><input required autoFocus value={f.company_name} onChange={set('company_name')} placeholder="e.g. Bright Spark Electrical Ltd" /></Field>
          <Field label="Your name"><input required value={f.name} onChange={set('name')} /></Field>
          <Field label="Email"><input type="email" required value={f.email} onChange={set('email')} /></Field>
          <Field label="Password" hint="At least 8 characters"><input type="password" required minLength={8} value={f.password} onChange={set('password')} /></Field>
          <button className="btn accent block" disabled={busy}>Create account</button>
        </div>
      </form>
    </div>
  );
}
