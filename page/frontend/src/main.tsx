import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { MotionConfig } from 'motion/react'
import { createHashHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { AppShell, GamePage } from './App'
import { store } from './store'
import './styles.css'

// Recover bookmarks from the former help page into the single game surface.
if (window.location.hash === '#/rules') window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`)

const rootRoute = createRootRoute({ component: () => <AppShell><Outlet /></AppShell> })
const gameRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: GamePage })
const router = createRouter({ routeTree: rootRoute.addChildren([gameRoute]), history: createHashHistory(), defaultPreload: 'intent' })

declare module '@tanstack/react-router' { interface Register { router: typeof router } }

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <MotionConfig reducedMotion="user">
      <RouterProvider router={router} />
    </MotionConfig>
  </Provider>,
)
