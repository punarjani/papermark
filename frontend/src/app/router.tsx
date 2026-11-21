import { createBrowserRouter } from 'react-router'

import { SystemStatusPage } from '../features/system-status/SystemStatusPage'
import { AppLayout } from './AppLayout'
import { RouteError } from './RouteError'

export const routes = [
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <SystemStatusPage /> },
      { path: '*', element: <RouteError /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
