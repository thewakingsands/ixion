export interface FlatField {
  index: number
  name: string
  link?: string
}

export interface DefinitionProvider {
  getFlatFields(sheet: string): Promise<FlatField[]>
}
