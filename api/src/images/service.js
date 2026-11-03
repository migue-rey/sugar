import crypto from 'node:crypto'
import { error, requiredText } from '../shared/http.js'
import { requireAdmin, requireEdit } from '../auth/policies.js'
import { imageBytes } from '../images.js'

export function createImageService(images) {
  return {
    async content(id) {
      const image = await images.content(id)
      if (!image) error(404, 'Imagen no encontrada')
      return image
    },
    async list() { return (await images.list()).map(image => ({ ...image, url: `/api/images/${image.id}/content` })) },
    async create(user, input) {
      requireEdit(user)
      const name = requiredText(input.name, 'Nombre').slice(0, 120), mime = String(input.mime || '')
      const bytes = imageBytes(mime, input.data), id = crypto.randomUUID()
      await images.create(id, name, mime, bytes, user.id)
      return { id, name, mime, url: `/api/images/${id}/content` }
    },
    async archive(id, user) {
      requireAdmin(user)
      if (!(await images.archive(id))) error(404, 'Imagen no encontrada')
    },
  }
}
