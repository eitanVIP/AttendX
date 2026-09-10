import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/students', label: 'Students' },
  { to: '/sessions', label: 'Attendance' },
  { to: '/trainings', label: 'Trainings' },
  { to: '/certifications', label: 'Certifications' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout() {
  const { team, memberships, logout } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="app-shell">
      <header className="app-header" style={{ '--accent': team?.colorPrimary || '#2563eb' }}>
        <button className="nav-toggle" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
          <span />
          <span />
          <span />
        </button>
        <div className="brand">
          <span className="brand-mark">AttendX</span>
          <Link to="/teams" className="brand-team" title="Switch teams">
            {team?.name || team?.id}
            {memberships.length > 1 ? ` (+${memberships.length - 1})` : ''}
          </Link>
        </div>
        <nav className="main-nav">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <button className="logout-btn" onClick={logout}>
          Log out
        </button>
      </header>

      <div
        className={`nav-drawer-overlay ${drawerOpen ? 'open' : ''}`}
        onClick={() => setDrawerOpen(false)}
        inert={drawerOpen ? undefined : true}
      >
        <nav className="nav-drawer" onClick={(e) => e.stopPropagation()}>
          <div className="nav-drawer-header">
            <span className="brand-mark">AttendX</span>
            <button className="nav-drawer-close" aria-label="Close menu" onClick={() => setDrawerOpen(false)}>
              &times;
            </button>
          </div>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => (isActive ? 'active' : '')}
              onClick={() => setDrawerOpen(false)}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
