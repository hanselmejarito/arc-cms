'use client'

import { Suspense } from 'react'
import dynamic from 'next/dynamic'

const App = dynamic(() => import('../../App.jsx'), { ssr: false })

export default function WorkspacePage() {
  return (
    <Suspense fallback={<div className="login-page"><div className="login-right"><p className="card-note">Loading workspace…</p></div></div>}>
      <App />
    </Suspense>
  )
}
