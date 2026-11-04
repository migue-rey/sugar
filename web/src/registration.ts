// Consume the fragment before any API calls. Tokens never enter query strings or storage.
export function takeVerificationToken(location: Pick<Location, 'hash' | 'pathname' | 'search'>, history: Pick<History, 'replaceState'>) {
  const token = new URLSearchParams(location.hash.slice(1)).get('verify-email')
  if (token === null) return ''
  history.replaceState(null, '', location.pathname + location.search)
  return /^[a-f0-9]{64}$/.test(token) ? token : 'invalid'
}
