import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { StudentAuthProvider } from './context/StudentAuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import StudentLayout from './components/StudentLayout'
import Login from './pages/Login'
import Teams from './pages/Teams'
import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import StudentProfile from './pages/StudentProfile'
import Trainings from './pages/Trainings'
import Certifications from './pages/Certifications'
import Sessions from './pages/Sessions'
import Inventory from './pages/Inventory'
import Orders from './pages/Orders'
import Systems from './pages/Systems'
import Settings from './pages/Settings'
import StudentLogin from './pages/StudentLogin'
import CommunityHours from './pages/CommunityHours'
import RequestOrder from './pages/RequestOrder'
import MySystems from './pages/MySystems'
import MyProfile from './pages/MyProfile'
import QuotaExceeded from './pages/QuotaExceeded'
import { useQuotaExceeded } from './lib/quotaStatus'

const QUOTA_PATH = '/quota-exceeded'

// Bounces every route to the quota page while Firestore's usage limit is
// hit (see quotaStatus.js) - QuotaExceeded itself is what clears the flag
// again, via its own polling, so there's no path back out of here except
// through it.
function QuotaGate({ children }) {
  const exceeded = useQuotaExceeded()
  const location = useLocation()
  if (exceeded && location.pathname !== QUOTA_PATH) {
    return <Navigate to={QUOTA_PATH} replace />
  }
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <StudentAuthProvider>
          <QuotaGate>
            <Routes>
              <Route path={QUOTA_PATH} element={<QuotaExceeded />} />
              <Route path="/login" element={<Login />} />
              <Route path="/teams" element={<Teams />} />
              <Route path="/student-login" element={<StudentLogin />} />
              <Route element={<StudentLayout />}>
                <Route path="/log-hours" element={<CommunityHours />} />
                <Route path="/request-order" element={<RequestOrder />} />
                <Route path="/my-systems" element={<MySystems />} />
                <Route path="/my-profile" element={<MyProfile />} />
              </Route>
              <Route
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route path="/" element={<Dashboard />} />
                <Route path="/students" element={<Students />} />
                <Route path="/students/:studentId" element={<StudentProfile />} />
                <Route path="/trainings" element={<Trainings />} />
                <Route path="/certifications" element={<Certifications />} />
                <Route path="/sessions" element={<Sessions />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/systems" element={<Systems />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
            </Routes>
          </QuotaGate>
        </StudentAuthProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
