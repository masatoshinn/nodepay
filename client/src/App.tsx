import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { LoadingBlock } from './components/Loading';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Invoices from './pages/Invoices';
import InvoiceDetail from './pages/InvoiceDetail';
import Payments from './pages/Payments';
import Wallets from './pages/Wallets';
import ApiKeys from './pages/ApiKeys';
import Webhooks from './pages/Webhooks';
import Settings from './pages/Settings';
import Docs from './pages/Docs';
import Admin from './pages/Admin';
import Checkout from './pages/Checkout';

function Protected({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingBlock label="Checking session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (admin && user.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/pay/:publicId" element={<Checkout />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/invoices" element={<Protected><Invoices /></Protected>} />
      <Route path="/invoices/:id" element={<Protected><InvoiceDetail /></Protected>} />
      <Route path="/payments" element={<Protected><Payments /></Protected>} />
      <Route path="/wallets" element={<Protected><Wallets /></Protected>} />
      <Route path="/api-keys" element={<Protected><ApiKeys /></Protected>} />
      <Route path="/webhooks" element={<Protected><Webhooks /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="/docs" element={<Protected><Docs /></Protected>} />
      <Route path="/admin" element={<Protected admin><Admin /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
