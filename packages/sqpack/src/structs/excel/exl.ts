export interface ExlEntry {
  name: string
  id: number
}

export interface ExlFile {
  magic: string
  version: number
  entries: ExlEntry[]
}

export const readExlFile = (buffer: Buffer): ExlFile => {
  const lines = buffer.toString().split('\n')
  const [magic, version] = lines[0].split(',')
  const entries = lines.slice(2).map((line) => {
    const [name, id] = line.split(',')
    return { name, id: parseInt(id, 10) }
  })

  return { magic, version: parseInt(version, 10), entries }
}
