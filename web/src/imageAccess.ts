// Share credentials exist only in the rendered URL, never in saved/exported YAML.
export function sharedImageUrl(image: string, token: string | null) {
  const match = /^\/api\/images\/([0-9a-f-]{36})\/content$/.exec(image)
  return match && token && /^[A-Za-z0-9_-]{43}$/.test(token) ? `/api/shared/${token}/images/${match[1]}/content` : image
}
