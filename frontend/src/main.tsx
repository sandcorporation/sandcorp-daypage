import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import './index.css'
import { startErrorReporting } from './errorReporting.ts'
import { HistoryPage } from './history/HistoryPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { NoteRoute } from './pages/NoteRoute.tsx'
import { StaffNotePage } from './staff/StaffNotePage.tsx'

// 화면을 기다리게 하지 않는다. 운영에서만 켜진다.
void startErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/note/:noteId" element={<NoteRoute />} />
        <Route path="/note/:noteId/history" element={<HistoryPage />} />
        <Route path="/note/:noteId/history/:date" element={<HistoryPage />} />
        {/* 운영자 보기(읽기 전용). 운영자가 아니면 노트를 찾을 수 없다고 보인다 */}
        <Route path="/staff/notes/:noteId" element={<StaffNotePage />} />
        <Route path="/staff/notes/:noteId/:date" element={<StaffNotePage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
