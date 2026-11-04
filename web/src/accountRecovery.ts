export type AccountAction = { kind: 'reset' | 'email_change'; token: string }
export function takeAccountAction(location: Pick<Location, 'hash' | 'pathname' | 'search'>, history: Pick<History, 'replaceState'>): AccountAction | null {
  const params = new URLSearchParams(location.hash.slice(1)), reset = params.get('reset-password'), email = params.get('confirm-email')
  if (reset === null && email === null) return null
  history.replaceState(null, '', location.pathname + location.search)
  const value = reset ?? email ?? ''
  return { kind: reset !== null ? 'reset' : 'email_change', token: reset !== null && email !== null ? 'invalid' : /^[a-f0-9]{64}$/.test(value) ? value : 'invalid' }
}
