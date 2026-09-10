import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Teams from './pages/Teams'
import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import StudentProfile from './pages/StudentProfile'
import Trainings from './pages/Trainings'
import Certifications from './pages/Certifications'
import Sessions from './pages/Sessions'
import Settings from './pages/Settings'
import CommunityHours from './pages/CommunityHours'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/log-hours" element={<CommunityHours />} />
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
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
