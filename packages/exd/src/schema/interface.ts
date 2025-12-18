import type { ExcelColumn } from '@ffcafe/ixion-sqpack'

export interface FlatField {
  index: number
  name: string
  link?: string
}

export interface DefinitionProvider {
  getFlatFields(sheet: string, columns: ExcelColumn[]): Promise<FlatField[]>
}
