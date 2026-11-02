export function safeHexColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined
}

export function headerStyle(value: unknown): Record<string, string> | undefined {
  const color = safeHexColor(value)
  if (!color) return undefined
  const channels = [1, 3, 5].map(index => {
    const channel = parseInt(color.slice(index, index + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  return { backgroundColor: color, color: luminance > 0.179 ? '#000000' : '#FFFFFF' }
}
