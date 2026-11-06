import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './styles.css';
import { api } from './api.js';
import { configureFormat, IS_DEMO } from './format.js';
import { AppCtx, ToastProvider, Loading, isOffice } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import { Login, Setup } from './pages/Auth.jsx';
import Home from './pages/Home.jsx';
import Schedule from './pages/Schedule.jsx';
import { ClientsList, ClientDetail } from './pages/Clients.jsx';
import { RequestsList, RequestForm, RequestDetail } from './pages/Requests.jsx';
import { QuotesList, QuoteForm, QuoteDetail } from './pages/Quotes.jsx';
import { JobsList, JobForm, JobDetail } from './pages/Jobs.jsx';
import { InvoicesList, InvoiceForm, InvoiceDetail } from './pages/Invoices.jsx';
import Expenses from './pages/Expenses.jsx';
import Timesheets from './pages/Timesheets.jsx';
import Insights from './pages/Insights.jsx';
import Marketing from './pages/Marketing.jsx';
import SettingsPage from './pages/Settings.jsx';
import { QuoteHub, InvoiceHub, BookingHub } from './hub/Hub.jsx';

function AppRoutes() {
  const [state, setState] = useState(null);
  const [counts, setCounts] = useState({});
  const loc = useLocation();

  const refresh = useCallback(() => api.get('/auth/status').then((s) => { configureFormat(s.settings); setState(s); }), []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const h = () => setState((s) => (s ? { ...s, user: null } : s));
    window.addEventListener('vl:unauthorized', h);
    return () => window.removeEventListener('vl:unauthorized', h);
  }, []);
  useEffect(() => {
    if (state?.user && isOffice(state.user)) api.get('/dashboard').then((d) => setCounts(d.todo || {})).catch(() => {});
  }, [state?.user, loc.pathname]);

  // Public client-hub pages never need a login
  if (loc.pathname.startsWith('/hub/')) {
    return (
      <Routes>
        <Route path="/hub/quote/:token" element={<QuoteHub />} />
        <Route path="/hub/invoice/:token" element={<InvoiceHub />} />
        <Route path="/hub/book" element={<BookingHub />} />
      </Routes>
    );
  }
  if (!state) return <Loading />;
  if (state.needsSetup) return <Setup onDone={refresh} />;
  if (!state.user) return <Login onDone={refresh} companyName={state.settings?.company_name} />;

  const ctx = {
    user: state.user, settings: state.settings, emailEnabled: state.emailEnabled, counts, refresh,
    logout: () => api.post('/auth/logout').finally(() => setState({ ...state, user: null })),
  };
  const office = isOffice(state.user);
  const guard = (el) => (office ? el : <Navigate to="/" replace />);
  return (
    <AppCtx.Provider value={ctx}>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/clients" element={<ClientsList />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/requests" element={guard(<RequestsList />)} />
          <Route path="/requests/new" element={guard(<RequestForm />)} />
          <Route path="/requests/:id" element={guard(<RequestDetail />)} />
          <Route path="/requests/:id/edit" element={guard(<RequestForm />)} />
          <Route path="/quotes" element={guard(<QuotesList />)} />
          <Route path="/quotes/new" element={guard(<QuoteForm />)} />
          <Route path="/quotes/:id" element={guard(<QuoteDetail />)} />
          <Route path="/quotes/:id/edit" element={guard(<QuoteForm />)} />
          <Route path="/jobs" element={<JobsList />} />
          <Route path="/jobs/new" element={guard(<JobForm />)} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/jobs/:id/edit" element={guard(<JobForm />)} />
          <Route path="/invoices" element={guard(<InvoicesList />)} />
          <Route path="/invoices/new" element={guard(<InvoiceForm />)} />
          <Route path="/invoices/:id" element={guard(<InvoiceDetail />)} />
          <Route path="/invoices/:id/edit" element={guard(<InvoiceForm />)} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/timesheets" element={<Timesheets />} />
          <Route path="/insights" element={guard(<Insights />)} />
          <Route path="/marketing" element={guard(<Marketing />)} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/:tab" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AppCtx.Provider>
  );
}

// The browser preview runs inside an embedded page, so it keeps routes in memory instead of the URL.
const Router = IS_DEMO ? MemoryRouter : BrowserRouter;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </Router>
  </React.StrictMode>,
);
