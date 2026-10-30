export function formatRelativeTime(timestamp: number, now = Date.now(), locale?: string): string {
  const elapsedSeconds = Math.max(0, (now - timestamp) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (elapsedSeconds < 60) return 'just now'
  if (elapsedSeconds < 60 * 60) {
    return formatter.format(-Math.floor(elapsedSeconds / 60), 'minute')
  }
  if (elapsedSeconds < 24 * 60 * 60) {
    return formatter.format(-Math.floor(elapsedSeconds / (60 * 60)), 'hour')
  }
  if (elapsedSeconds < 7 * 24 * 60 * 60) {
    return formatter.format(-Math.floor(elapsedSeconds / (24 * 60 * 60)), 'day')
  }
  if (elapsedSeconds < 30 * 24 * 60 * 60) {
    return formatter.format(-Math.floor(elapsedSeconds / (7 * 24 * 60 * 60)), 'week')
  }
  if (elapsedSeconds < 365 * 24 * 60 * 60) {
    return formatter.format(-Math.floor(elapsedSeconds / (30 * 24 * 60 * 60)), 'month')
  }
  return formatter.format(-Math.floor(elapsedSeconds / (365 * 24 * 60 * 60)), 'year')
}
