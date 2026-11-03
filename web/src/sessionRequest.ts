// Notify the shell without retrying requests (especially paid AI operations).
export async function sessionRequest(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)
  if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('sugar:session-expired'))
  return response
}
