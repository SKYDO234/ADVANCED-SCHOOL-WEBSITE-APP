import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './store.jsx';
import { Loading, ToastProvider } from './ui/index.jsx';
import AppShell from './layout/AppShell.jsx';

import PublicSite from './pages/PublicSite.jsx';
import Login from './pages/Login.jsx';
import Setup from './pages/Setup.jsx';

// Core pages are eager; heavy admin pages load on demand.
import Dashboard from './pages/Dashboard.jsx';
import Students from './pages/Students.jsx';
import StudentDetail from './pages/StudentDetail.jsx';
import Attendance from './pages/Attendance.jsx';
import Academics from './pages/Academics.jsx';
import Exams from './pages/Exams.jsx';
import ExamDetail from './pages/ExamDetail.jsx';
import Results from './pages/Results.jsx';
import Timetable from './pages/Timetable.jsx';
import Fees from './pages/Fees.jsx';
import InvoiceDetail from './pages/InvoiceDetail.jsx';
import Employees from './pages/Employees.jsx';
import Users from './pages/Users.jsx';
import Library from './pages/Library.jsx';
import Transport from './pages/Transport.jsx';
import Homework from './pages/Homework.jsx';
import Communication from './pages/Communication.jsx';
import Reports from './pages/Reports.jsx';
import Website from './pages/Website.jsx';
import Portal from './pages/Portal.jsx';

const Settings = lazy(() => import('./pages/Settings.jsx'));
const Payroll = lazy(() => import('./pages/Payroll.jsx'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function FullScreenLoader({ label = 'Loading workspace…' }) {
  return <div className="boot-screen"><span className="spinner" /><span>{label}</span></div>;
}

/** Requires a signed-in staff account. */
function RequireStaff({ children }) {
  const { status, user } = useApp();
  const location = useLocation();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'setup') return <Navigate to="/setup" replace />;
  if (status !== 'ready' || !user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (['student', 'parent'].includes(user.role)) return <Navigate to="/portal" replace />;
  return children;
}

/** Requires a student/parent account. */
function RequirePortal({ children }) {
  const { status, user } = useApp();
  const location = useLocation();
  if (status === 'loading') return <FullScreenLoader />;
  if (status !== 'ready' || !user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!['student', 'parent'].includes(user.role)) return <Navigate to="/app" replace />;
  return children;
}

function NotFound() {
  const { user } = useApp();
  return (
    <div className="empty" style={{ minHeight: '60vh', justifyContent: 'center' }}>
      <span className="empty-icon">404</span>
      <h4>Page not found</h4>
      <p>The page you are looking for has moved or never existed.</p>
      <a className="btn btn-primary mt-2" href={user ? '/app' : '/'}>{user ? 'Back to dashboard' : 'Back to website'}</a>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PublicSite />} />
      <Route path="/p/:slug" element={<PublicSite />} />
      <Route path="/login" element={<Login />} />
      <Route path="/setup" element={<Setup />} />

      <Route path="/portal" element={<RequirePortal><Portal /></RequirePortal>} />

      <Route path="/app" element={<RequireStaff><AppShell /></RequireStaff>}>
        <Route index element={<Dashboard />} />
        <Route path="students" element={<Students />} />
        <Route path="students/:id" element={<StudentDetail />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="academics" element={<Academics />} />
        <Route path="exams" element={<Exams />} />
        <Route path="exams/:id" element={<ExamDetail />} />
        <Route path="results" element={<Results />} />
        <Route path="timetable" element={<Timetable />} />
        <Route path="homework" element={<Homework />} />
        <Route path="fees" element={<Fees />} />
        <Route path="fees/invoices/:id" element={<InvoiceDetail />} />
        <Route path="payroll" element={<Suspense fallback={<Loading label="Loading payroll…" />}><Payroll /></Suspense>} />
        <Route path="employees" element={<Employees />} />
        <Route path="users" element={<Users />} />
        <Route path="library" element={<Library />} />
        <Route path="transport" element={<Transport />} />
        <Route path="communication" element={<Communication />} />
        <Route path="reports" element={<Reports />} />
        <Route path="website" element={<Website />} />
        <Route path="settings" element={<Suspense fallback={<Loading label="Loading settings…" />}><Settings /></Suspense>} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <ToastProvider>
          <ScrollToTop />
          <AppRoutes />
        </ToastProvider>
      </AppProvider>
    </BrowserRouter>
  );
}
