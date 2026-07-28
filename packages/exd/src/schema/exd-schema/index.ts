import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExcelColumn } from '@ffcafe/ixion-sqpack'
import yaml from 'yaml'
import type { DefinitionProvider, FlatField } from '../interface'
import { EXDSchema, NamedFieldSchema, UnnamedFieldSchema } from './interface'

export * from './interface'

/** Parse array fields in ArrayFieldSchema that are not verified by zod */
export function parseArrayFields(
  data: unknown[],
): [UnnamedFieldSchema] | NamedFieldSchema[] {
  if (data.length === 1) {
    return [UnnamedFieldSchema.parse(data[0])]
  }

  return data.map((field) => NamedFieldSchema.parse(field))
}

export async function loadEXDSchema(dir: string, sheet: string) {
  const fileName = `${sheet}.yml`
  try {
    const data = yaml.parse(await readFile(join(dir, fileName), 'utf-8'))
    return EXDSchema.parse(data)
  } catch (error) {
    throw new Error(`Failed to load ${fileName}`, { cause: error })
  }
}

export async function loadAllEXDSchema(
  dir: string,
): Promise<Record<string, NamedFieldSchema[]>> {
  const files = await readdir(dir)
  const schema: Record<string, NamedFieldSchema[]> = {}
  for (const file of files) {
    if (!file.endsWith('.yml')) continue
    const parsed = await loadEXDSchema(dir, file.slice(0, -4))
    if (schema[parsed.name]) {
      throw new Error(`Duplicate schema name: ${parsed.name}`)
    }
    schema[parsed.name] = parsed.fields
  }

  return schema
}

const typeMap: Record<string, string> = {
  icon: 'Image',
}

function generateFlatFields(schema: EXDSchema) {
  const fields: FlatField[] = []

  const currentIndex = 0
  const processData = (data: NamedFieldSchema, suffix: string = '') => {
    if (data.type === 'link') {
      let link: string | undefined
      if (data.targets) {
        link = data.targets.length > 1 ? 'Row' : data.targets[0]
      } else if (data.condition) {
        link = data.condition.switch
      }
      fields.push({
        index: currentIndex,
        name: data.name,
        link,
      })
    } else if (data.type === 'array') {
      fields.push({
        index: currentIndex,
        name: data.name,
        link: '',
      })
    } else {
      fields.push({
        index: currentIndex,
        name: data.name,
        link: (data.type && typeMap[data.type]) || '',
      })
    }
  }

  for (const field of schema.fields) {
    processData(field)
  }

  return fields
}

export class EXDSchemaDefinitionProvider implements DefinitionProvider {
  constructor(private readonly dir: string) {}

  async getFlatFields(
    sheet: string,
    columns: ExcelColumn[],
  ): Promise<FlatField[]> {
    const schema = await loadEXDSchema(this.dir, sheet).catch(() => null)
    if (!schema) {
      return []
    }

    const fields = generateFlatFields(schema)

    // convert offset order to column index order
    const columnWithIndex = columns.map((column, index) => ({
      ...column,
      index,
    }))

    columnWithIndex.sort((a, b) => {
      if (a.offset === b.offset) {
        // return b.type - a.type
        return a.type - b.type
      }

      return a.offset - b.offset
    })

    const result: FlatField[] = []
    for (let i = 0; i < columnWithIndex.length; i++) {
      const offsetIndex = i
      const columnIndex = columnWithIndex[i].index

      result[columnIndex] = fields[offsetIndex]
    }

    return result
  }
}
