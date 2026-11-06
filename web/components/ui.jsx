import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X, Inbox } from 'lucide-react';
import { STATUS_LABELS, STATUS_TONE, initials } from '../format.js';
import { api } from '../api.js';

// ---------- app context (user, settings, team) ----------
export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);
export const isOffice = (u) => ['owner', 'admin', 'office'].includes(u?.role);
export const isAdmin = (u) => ['owner', 'admin'].includes(u?.role);

// ---------- in-app confirm (replaces window.confirm, which embedded browsers can block) ----------
let confirmHost = null;
/** Ask the user to confirm. Resolves true/false. */
export function askConfirm(message, { confirmLabel = 'Confirm', danger = true } = {}) {
  return new Promise((resolve) => (confirmHost ? confirmHost({ message, confirmLabel, danger, resolve }) : resolve(window.confirm(message))));
}
function ConfirmHost() {
  const [q, setQ] = useState(null);
  useEffect(() => { confirmHost = setQ; return () => { confirmHost = null; }; }, []);
  if (!q) return null;
  const done = (v) => { q.resolve(v); setQ(null); };
  return (
    <Modal title="Are you sure?" onClose={() => done(false)} footer={<>
      <button className="btn" onClick={() => done(false)}>Cancel</button>
      <button className={`btn ${q.danger ? 'danger solid' : 'primary'}`} autoFocus onClick={() => done(true)}>{q.confirmLabel}</button>
    </>}><p>{q.message}</p></Modal>
  );
}

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 5000 : 2800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <ConfirmHost />
      <div className="toasts" role="status">{toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}

// ---------- data loading hook ----------
export function useLoad(url, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const load = useCallback(() => {
    if (!url) { setState({ data: null, loading: false, error: null }); return Promise.resolve(); }
    setState((s) => ({ ...s, loading: true }));
    return api.get(url).then((data) => setState({ data, loading: false, error: null })).catch((error) => setState({ data: null, loading: false, error }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

/** Wrap an async action: shows toast on error, busy flag. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
    catch (e) { toast(e.message, 'error'); throw e; }
    finally { setBusy(false); }
  }, [toast]);
  return [run, busy];
}

// ---------- primitives ----------
export function Status({ s }) {
  return <span className={`badge ${STATUS_TONE[s] || ''}`}>{STATUS_LABELS[s] || s}</span>;
}
export function Avatar({ name, color, sm }) {
  return <span className={`avatar${sm ? ' sm' : ''}`} style={{ background: color || '#56616b' }} title={name}>{initials(name)}</span>;
}
export function Avatars({ users = [] }) {
  if (!users.length) return <span className="faint small">Unassigned</span>;
  return <span className="avatars">{users.map((u) => <Avatar key={u.id} sm name={u.name} color={u.color} />)}</span>;
}
export function Field({ label, children, full, hint }) {
  return <label className={`field${full ? ' full' : ''}`}><span>{label}</span>{children}{hint && <small className="faint">{hint}</small>}</label>;
}
export function Loading() { return <div className="empty"><div className="muted">Loading…</div></div>; }
export function ErrorBox({ error }) { return <div className="notice red">{error?.message || 'Something went wrong'}</div>; }
export function Empty({ icon: Icon = Inbox, title, children, action }) {
  return (
    <div className="empty">
      <div className="icon"><Icon size={24} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="btn ghost icon" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, children, confirmLabel = 'Confirm', danger, onConfirm, onClose }) {
  const [run, busy] = useAction();
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'danger solid' : 'primary'}`} disabled={busy} onClick={() => run(onConfirm).then(onClose).catch(() => {})}>{confirmLabel}</button>
    </>}>{children}</Modal>
  );
}

export function Dropdown({ label, children, className = 'btn', align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const h = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="dropdown" ref={ref}>
      <button type="button" className={className} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{label}</button>
      {open && <div className="menu" style={{ [align]: 0, top: 'calc(100% + 6px)' }} onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}
export function Chips({ options, value, onChange }) {
  return <div className="chips">{options.map(([k, l]) => <button key={k} type="button" className={`chip${value === k ? ' on' : ''}`} onClick={() => onChange(k)}>{l}</button>)}</div>;
}
export function Seg({ options, value, onChange }) {
  return <div className="seg">{options.map(([k, l]) => <button key={k} type="button" className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

export function Delta({ value, previous }) {
  if (!previous && !value) return <span className="delta">0%</span>;
  if (!previous) return <span className="delta up">new</span>;
  const pct = Math.round(((value - previous) / previous) * 100);
  return <span className={`delta ${pct > 0 ? 'up' : pct < 0 ? 'down' : ''}`}>{pct > 0 ? '↑' : pct < 0 ? '↓' : ''}{Math.abs(pct)}%</span>;
}

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
