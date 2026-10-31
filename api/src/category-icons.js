export const CATEGORY_ICONS = ['cube', 'power', 'battery', 'cpu', 'sensor', 'temperature', 'network', 'radio', 'display', 'storage', 'motor', 'audio', 'light', 'connector', 'clock', 'shield']
export function categoryIcon(value, parentId, previous) {
  const icon = value === undefined ? previous === undefined ? parentId ? null : 'cube' : previous : value
  if ((icon === null && parentId) || CATEGORY_ICONS.includes(icon)) return icon
  throw Object.assign(new Error('Selecciona un icono válido para la categoría'), { status: 400 })
}
