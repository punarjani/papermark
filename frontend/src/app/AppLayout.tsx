import { FileCheck2 } from 'lucide-react'
import { Outlet } from 'react-router'

export function AppLayout() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
          <FileCheck2 aria-hidden className="h-6 w-6 text-indigo-600" />
          <span className="text-lg font-semibold tracking-tight">PaperMark</span>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
