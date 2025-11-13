import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DefinitionSchema } from './interface'

export async function loadSaintcoinachDefinition(dir: string, sheet: string) {
  const fileName = `${sheet}.json`
  try {
    const data = JSON.parse(await readFile(join(dir, fileName), 'utf-8'))
    return DefinitionSchema.parse(data)
  } catch (error) {
    throw new Error(`Failed to load ${fileName}`, { cause: error })
  }
}
