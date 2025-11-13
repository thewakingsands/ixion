import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'yaml'
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
