import { useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import StudentProfileView from '../components/StudentProfileView'
import {
  useCommunityLogs,
  useCommunitySettings,
  useSessions,
  useStudentAttendance,
  useStudents,
  useTrainings,
} from '../lib/firestore-hooks'
import { deleteCommunityLog } from '../lib/actions'

// The admin's own view of one student - full access (can delete a
// mis-logged community-hours entry), fetched through the normal admin
// hooks. See StudentProfileView for everything this and the read-only
// student-facing MyProfile.jsx share.
export default function StudentProfile() {
  const { studentId } = useParams()
  const { team } = useAuth()
  const { data: students } = useStudents(team)
  const { data: trainings } = useTrainings(team?.id)
  const { data: sessions } = useSessions(team?.id)
  const { data: attendanceRecords, loading: attendanceLoading } = useStudentAttendance(team?.id, studentId)
  const { data: communityLogs } = useCommunityLogs(team?.id)
  const { settings: communitySettings } = useCommunitySettings(team?.id)

  const student = students.find((s) => s.id === studentId)

  async function handleDeleteLog(log) {
    if (!confirm(`Delete this entry (${log.hours}h, ${log.type}, ${log.date})?`)) return
    await deleteCommunityLog(team.id, log.id)
  }

  if (!student) return <div className="page-loading">Loading student…</div>

  return (
    <StudentProfileView
      student={student}
      attendanceRecords={attendanceRecords}
      attendanceLoading={attendanceLoading}
      sessions={sessions}
      trainings={trainings}
      communityLogs={communityLogs}
      communitySettings={communitySettings}
      divisions={team?.divisions || []}
      subdivisionsByDivision={team?.subdivisionsByDivision || {}}
      onDeleteLog={handleDeleteLog}
      backLink={{ to: '/students', label: 'Students' }}
    />
  )
}
