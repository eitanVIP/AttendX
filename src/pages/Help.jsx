import { useEffect } from 'react'
import GuideView from '../components/GuideView'
import { STUDENT_GUIDE } from '../lib/guide'

// The student guide (a StudentLayout tab).
export default function Help() {
  useEffect(() => {
    document.title = 'AttendX | Guide'
  }, [])
  return <GuideView title="Guide" intro="How to use AttendX as a student." sections={STUDENT_GUIDE} />
}
