import { Link } from 'react-router-dom'

export default function NoDivisionsNotice({ team }) {
  if (team?.divisions?.length) return null
  return (
    <p className="notice">
      This team has no divisions yet. <Link to="/settings">Set them up in Settings</Link> before adding
      students, trainings or sessions.
    </p>
  )
}
