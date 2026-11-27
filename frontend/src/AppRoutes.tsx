import { Route, Routes } from 'react-router'
import { HistoryPage } from './history/HistoryPage.tsx'
import { ErrorScreen } from './pages/ErrorScreen.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { NoteRoute } from './pages/NoteRoute.tsx'
import { StaffNotePage } from './staff/StaffNotePage.tsx'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/note/:noteId" element={<NoteRoute />} />
      <Route path="/note/:noteId/history" element={<HistoryPage />} />
      <Route path="/note/:noteId/history/:pageKey" element={<HistoryPage />} />
      {/* 운영자 보기(읽기 전용). 운영자가 아니면 노트를 찾을 수 없다고 보인다 */}
      <Route path="/staff/notes/:noteId" element={<StaffNotePage />} />
      <Route path="/staff/notes/:noteId/:pageKey" element={<StaffNotePage />} />
      <Route path="*" element={<ErrorScreen kind="missing" />} />
    </Routes>
  )
}
