import crypto from 'node:crypto'
import { createPatch } from 'diff'
import { error, requiredText } from '../shared/http.js'
import { requireAdmin, requireEdit } from '../auth/policies.js'
import { normalizeColorLiterals, stringify, validateBlock } from '../model.js'

export function createBlockService({ blocks, transaction, validateCategory, replaceEmbeddedImages }) {
  return {
    list: () => blocks.list(),
    async create(user, input) {
      requireEdit(user)
      const yaml = normalizeColorLiterals(requiredText(input.yaml, 'YAML')), block = validateBlock(yaml), id = crypto.randomUUID(), summary = input.summary || 'Bloque creado'
      await transaction(async tx => {
        await validateCategory(block, tx)
        await blocks.create(id, block, tx)
        await blocks.addVersion(id, 1, yaml, user.id, summary, tx)
      })
      return { id, version: 1 }
    },
    versions: id => blocks.versions(id),
    async version(id, version) {
      const saved = await blocks.version(id, version)
      if (!saved) error(404, 'Versión no encontrada')
      return saved.yaml
    },
    async diff(id, input) {
      const a = Number(input.from), b = Number(input.to)
      if (!Number.isInteger(a) || !Number.isInteger(b)) error(400, 'Selecciona dos versiones')
      const rows = await blocks.comparison(id, a, b)
      const one = rows.find(r => r.version === a), two = rows.find(r => r.version === b)
      if (!one || !two) error(404, 'Versión no encontrada')
      return createPatch('block.yaml', one.yaml, two.yaml, `version ${a}`, `version ${b}`)
    },
    async restore(id, user, input) {
      requireEdit(user)
      const wanted = Number(input.version), expected = Number(input.expectedVersion)
      if (!Number.isInteger(wanted) || !Number.isInteger(expected)) error(400, 'Versión inválida')
      const source = await blocks.version(id, wanted)
      if (!source) error(404, 'Versión no encontrada')
      const version = await transaction(async tx => {
        let yaml = normalizeColorLiterals(await replaceEmbeddedImages(source.yaml, 'block', tx))
        let block = validateBlock(yaml)
        if (input.category) {
          block.category = input.category
          if (input.subcategory) block.subcategory = input.subcategory
          else delete block.subcategory
          yaml = stringify(block)
          block = validateBlock(yaml)
        }
        await validateCategory(block, tx, !block.category)
        const saved = await blocks.save(id, expected, block, tx)
        if (!saved) error(409, 'El bloque cambió; recarga antes de restaurar')
        const version = saved.latest_version
        await blocks.addVersion(id, version, yaml, user.id, `Restaurada versión ${wanted}`, tx)
        return version
      })
      return { version }
    },
    async save(id, user, input) {
      requireEdit(user)
      const yaml = normalizeColorLiterals(requiredText(input.yaml, 'YAML')), block = validateBlock(yaml), expected = Number(input.expectedVersion)
      if (!Number.isInteger(expected) || expected < 1) error(400, 'Versión esperada inválida')
      const version = await transaction(async tx => {
        await validateCategory(block, tx)
        const saved = await blocks.save(id, expected, block, tx)
        if (!saved) error(409, 'El bloque cambió; recarga antes de guardar')
        const version = saved.latest_version
        await blocks.addVersion(id, version, yaml, user.id, input.summary || 'Bloque actualizado', tx)
        return version
      })
      return { version }
    },
    async archive(id, user) { requireAdmin(user); await blocks.archive(id) },
  }
}
