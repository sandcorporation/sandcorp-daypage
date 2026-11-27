import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './fonts.css'
import './index.css'
import { startErrorReporting } from './errorReporting.ts'
import { AppRoutes } from './AppRoutes.tsx'

// 화면을 기다리게 하지 않는다. 운영에서만 켜진다.
void startErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  </StrictMode>,
)
