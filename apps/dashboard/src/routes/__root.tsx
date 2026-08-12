import { HeadContent, Link, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { ColorSchemeScript, Group, MantineProvider, Text, mantineHtmlProps } from '@mantine/core'

import mantineCss from '@mantine/core/styles.css?url'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Porlocal',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: mantineCss,
      },
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  component: RootLayout,
  shellComponent: RootDocument,
})

function RootLayout() {
  return (
    <>
      <Group px="lg" py="sm" gap="lg" style={{ borderBottom: '1px solid light-dark(#e5e5e5, #373a40)' }}>
        <Text fw={700}>Porlocal</Text>
        <Link to="/" activeOptions={{ exact: true }} activeProps={{ style: { fontWeight: 600 } }}>
          Dashboard
        </Link>
        <Link to="/ports" activeProps={{ style: { fontWeight: 600 } }}>
          System ports
        </Link>
      </Group>
      <Outlet />
    </>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript />
        <HeadContent />
      </head>
      <body>
        <MantineProvider>{children}</MantineProvider>

        <Scripts />
      </body>
    </html>
  )
}
