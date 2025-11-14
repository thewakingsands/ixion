import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FlatField } from '../interface'
import { Data, DefinitionSchema } from './interface'

export async function loadSaintcoinachDefinition(dir: string, sheet: string) {
  const fileName = `${sheet}.json`
  try {
    const data = JSON.parse(await readFile(join(dir, fileName), 'utf-8'))
    return DefinitionSchema.parse(data)
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw new Error(`Failed to load ${fileName}`, { cause: error })
  }
}

function extractLink(converter: any): string | undefined {
  if (!converter) {
    return undefined
  }

  switch (converter.type) {
    case 'link':
      return converter.target
    case 'icon':
      return 'Image'
    case 'tomestone':
      return 'Item'
    case 'color':
      return 'Color'
    case 'complexlink':
    case 'multiref':
    case 'generic':
      return 'Row'
    default:
      return undefined
  }
}

export function generateFlatFields(definition: DefinitionSchema | null) {
  const fields: FlatField[] = []
  if (!definition) {
    return fields
  }

  let currentIndex = 0
  const processData = (data: Data, suffix: string = '') => {
    if (data.index) {
      currentIndex = data.index
    }

    if (!data.type) {
      // SingleData
      const name = `${data.name}${suffix}`.trim()
      const link = extractLink(data.converter)

      fields[currentIndex] = { index: currentIndex, name, link }
      currentIndex++
    } else if (data.type === 'group') {
      // GroupData - process members sequentially
      for (const member of data.members) {
        processData(Data.parse(member), suffix)
      }
    } else if (data.type === 'repeat') {
      // RepeatData - repeat the definition count times
      // Check if definition is a single field (has name) or a group
      const member = Data.parse(data.definition)
      for (let i = 0; i < data.count; i++) {
        processData(member, `[${i}]${suffix}`)
      }
    }
  }

  // Process all definitions
  for (const data of definition.definitions) {
    processData(data, '')
  }

  // Fill in any gaps with empty name fields
  for (let i = 0; i < fields.length; i++) {
    if (fields[i]) continue
    fields[i] = { index: i, name: '' }
  }

  return fields
}
