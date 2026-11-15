import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import { ColorSchemeScript, MantineProvider, createTheme, mantineHtmlProps } from '@mantine/core'
import { ModalsProvider } from '@mantine/modals'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

const theme = createTheme({ primaryColor: 'blue', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' })
// Keep showing the last state while the daemon restarts: polling retries on its own.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 1000 } } })

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'porlocal' }],
  }),
  shellComponent: RootDocument,
  component: () => <Outlet />,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
        <HeadContent />
      </head>
      <body>
        <MantineProvider theme={theme} defaultColorScheme="auto">
          <QueryClientProvider client={queryClient}>
            <ModalsProvider>
              <Notifications position="bottom-right" />
              {children}
            </ModalsProvider>
          </QueryClientProvider>
        </MantineProvider>
        <Scripts />
      </body>
    </html>
  )
}
