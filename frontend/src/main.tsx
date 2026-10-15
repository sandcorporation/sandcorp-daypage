import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import './index.css'
import { HistoryPage } from './history/HistoryPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { NoteRoute } from './pages/NoteRoute.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/note/:noteId" element={<NoteRoute />} />
        <Route path="/note/:noteId/history" element={<HistoryPage />} />
        <Route path="/note/:noteId/history/:date" element={<HistoryPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
