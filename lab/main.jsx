import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import './lab.css'
import TableLab from './TableLab'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TableLab />
  </StrictMode>
)
