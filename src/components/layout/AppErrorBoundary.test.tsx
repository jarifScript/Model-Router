import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

describe('application error fallback', () => {
  it('shows a reload action without rendering error details', () => {
    const boundary = new AppErrorBoundary({ children: null })
    const privateError = new Error('private provider response')
    boundary.state = AppErrorBoundary.getDerivedStateFromError(privateError)
    const markup = renderToStaticMarkup(boundary.render())

    expect(markup).toContain('The page could not be shown')
    expect(markup).toContain('Reload page')
    expect(markup).not.toContain(privateError.message)
  })
})
