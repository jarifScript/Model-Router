// Application routes; protected routes are grouped inside the app shell.
import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import AppShell from '../components/layout/AppShell'
import ProtectedRoute, { AdvancedFeatureRoute } from '../components/layout/ProtectedRoute'

const DashboardPage = lazy(() => import('../pages/DashboardPage'))
const LoginPage = lazy(() => import('../pages/LoginPage'))
const UnlockPage = lazy(() => import('../pages/UnlockPage'))
const ProvidersPage = lazy(() => import('../pages/ProvidersPage'))
const RoutesPage = lazy(() => import('../pages/RoutesPage'))
const PlaygroundPage = lazy(() => import('../pages/PlaygroundPage'))
const LogsPage = lazy(() => import('../pages/LogsPage'))
const SettingsPage = lazy(() => import('../pages/SettingsPage'))
const ModelsPage = lazy(() => import('../pages/ModelsPage'))

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/unlock', element: <UnlockPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <Navigate to="/dashboard" replace /> },
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/providers', element: <ProvidersPage /> },
          { path: '/models', element: <ModelsPage /> },
          { path: '/routes', element: <AdvancedFeatureRoute><RoutesPage /></AdvancedFeatureRoute> },
          { path: '/playground', element: <PlaygroundPage /> },
          { path: '/logs', element: <AdvancedFeatureRoute><LogsPage /></AdvancedFeatureRoute> },
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
])
