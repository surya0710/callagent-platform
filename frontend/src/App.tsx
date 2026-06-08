import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthBootstrap } from './components/auth/AuthBootstrap';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { AppLayout } from './components/layout/AppLayout';
import { AgentPromptsPage } from './pages/AgentPromptsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { CallDetailPage } from './pages/CallDetailPage';
import { CallsPage } from './pages/CallsPage';
import { CampaignDetailPage } from './pages/CampaignDetailPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { CustomerDetailPage } from './pages/CustomerDetailPage';
import { CustomersPage } from './pages/CustomersPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsersPage } from './pages/UsersPage';

export function App() {
  return (
    <AuthBootstrap>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="customers/:id" element={<CustomerDetailPage />} />
            <Route path="campaigns" element={<CampaignsPage />} />
            <Route path="campaigns/:id" element={<CampaignDetailPage />} />
            <Route path="calls" element={<CallsPage />} />
            <Route path="calls/:id" element={<CallDetailPage />} />
            <Route path="agent-prompts" element={<AgentPromptsPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthBootstrap>
  );
}
