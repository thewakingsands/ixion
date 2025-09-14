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
  const lines = buffer.toString().split('\r\n')
  const ret: ExlFile = {
    magic: '',
    version: 0,
    entries: [],
  }

  for (let i = 0; i < lines.length; i++) {
    if (i === 0) {
      const [magic, version] = lines[0].split(',')
      ret.magic = magic
      ret.version = parseInt(version, 10)
      continue
    }

    const [name, id] = lines[i].split(',')
    const idNumber = parseInt(id, 10)
    if (Number.isNaN(idNumber)) {
      continue
    }

    ret.entries.push({ name, id: idNumber })
  }

  return ret
}

/**
 * Write EXL file structure
 */
export const writeExlFile = (exlFile: ExlFile): Buffer => {
  const lines: string[] = []

  // Write header
  lines.push(`${exlFile.magic},${exlFile.version}`)

  // Write entries
  for (const entry of exlFile.entries) {
    lines.push(`${entry.name},${entry.id}`)
  }

  lines.push('')
  return Buffer.from(lines.join('\r\n'))
}
