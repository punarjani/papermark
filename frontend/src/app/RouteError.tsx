import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

/** Route-level error boundary. Shows a safe message; never renders raw error objects. */
export function RouteError() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  if (!notFound) console.error(error)

  return (
    <section className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">{notFound ? 'Page not found' : 'Something went wrong'}</h1>
      <p className="mt-2 text-slate-600">
        {notFound
          ? 'The page you requested does not exist.'
          : 'An unexpected error occurred. Please reload the page.'}
      </p>
      <Link className="mt-6 inline-block text-indigo-600 hover:underline" to="/">
        Go to home
      </Link>
    </section>
  )
}
