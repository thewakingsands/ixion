import { SmartBuffer } from 'smart-buffer'
import {
  excelDataRowHeaderSize,
  type IExdDataRow,
  type IExdDataSubRow,
  readExcelDataHeader,
  readExcelDataRowHeader,
  subRowIdSize,
} from './exd'
import {
  type ExcelColumn,
  ExcelColumnDataType,
  ExcelVariant,
  type ExhHeader,
} from './exh'

export class EXDReader {
  private buffer: SmartBuffer
  private offsetMap: Map<number, number>
  private rowDataSize: number
  private variant: ExcelVariant
  private columns: ExcelColumn[]

  constructor(buffer: Buffer, exhHeader: ExhHeader) {
    this.buffer = SmartBuffer.fromBuffer(buffer)
    const exdHeader = readExcelDataHeader(this.buffer)
    this.offsetMap = exdHeader.offsetMap
    this.rowDataSize = exhHeader.dataOffset
    this.variant = exhHeader.variant
    this.columns = exhHeader.columns
  }

  get isSubrows(): boolean {
    return this.variant === ExcelVariant.Subrows
  }

  readRow(rowId: number): any[] {
    const { offset, rowCount } = this.readRowHeader(rowId)
    if (rowCount !== 1) {
      throw new Error(`Row ${rowId} has ${rowCount} rows, expected 1`)
    }

    return this.readColumns(offset)
  }

  readSubrow(rowId: number, subRowIndex: number): IExdDataSubRow {
    const { offset, rowCount } = this.readRowHeader(rowId)
    if (subRowIndex >= rowCount) {
      throw new Error(
        `Subrow ${subRowIndex} out of range, expected 0-${rowCount - 1}`,
      )
    }

    const subRowOffset =
      offset + subRowIndex * (this.rowDataSize + subRowIdSize)
    return {
      subRowId: this.readSubRowId(subRowOffset),
      data: this.readColumns(subRowOffset + subRowIdSize),
    }
  }

  listRowIds() {
    return Array.from(this.offsetMap.keys())
  }

  readRows(): IExdDataRow[] {
    const rows: IExdDataRow[] = []
    for (const rowId of this.listRowIds()) {
      if (this.isSubrows) {
        const subRows: IExdDataSubRow[] = []
        for (let i = 0; i < this.getSubRowCount(rowId); i++) {
          subRows.push(this.readSubrow(rowId, i))
        }

        rows.push({ rowId, data: subRows })
      } else {
        rows.push({ rowId, data: this.readRow(rowId) })
      }
    }
    return rows
  }

  getSubRowCount(rowId: number) {
    const { rowCount } = this.readRowHeader(rowId)
    return rowCount
  }

  private readRowHeader(rowId: number) {
    const headerOffset = this.offsetMap.get(rowId)
    if (!headerOffset) {
      throw new Error(`Row ${rowId} not found`)
    }

    this.buffer.readOffset = headerOffset
    const { dataSize, rowCount } = readExcelDataRowHeader(this.buffer)
    return {
      offset: headerOffset + excelDataRowHeaderSize,
      rowCount,
      dataSize,
    }
  }

  private readSubRowId(rowOffset: number): number {
    this.buffer.readOffset = rowOffset
    return this.buffer.readUInt16BE()
  }

  private readColumns(rowOffset: number): any[] {
    return this.columns.map((column) => this.readColumn(rowOffset, column))
  }

  private readColumn(rowOffset: number, column: ExcelColumn): any {
    this.buffer.readOffset = rowOffset + column.offset
    switch (column.type) {
      case ExcelColumnDataType.String: {
        const columnValue = this.buffer.readUInt32BE()
        return this.readString(rowOffset, columnValue)
      }
      case ExcelColumnDataType.Bool:
        return this.buffer.readUInt8() === 1
      case ExcelColumnDataType.Int8:
        return this.buffer.readInt8()
      case ExcelColumnDataType.UInt8:
        return this.buffer.readUInt8()
      case ExcelColumnDataType.Int16:
        return this.buffer.readInt16BE()
      case ExcelColumnDataType.UInt16:
        return this.buffer.readUInt16BE()
      case ExcelColumnDataType.Int32:
        return this.buffer.readInt32BE()
      case ExcelColumnDataType.UInt32:
        return this.buffer.readUInt32BE()
      case ExcelColumnDataType.Float32:
        return this.buffer.readFloatBE()
      case ExcelColumnDataType.Int64:
        return this.buffer.readBigInt64BE()
      case ExcelColumnDataType.UInt64:
        return this.buffer.readBigUInt64BE()
      case ExcelColumnDataType.PackedBool0:
      case ExcelColumnDataType.PackedBool1:
      case ExcelColumnDataType.PackedBool2:
      case ExcelColumnDataType.PackedBool3:
      case ExcelColumnDataType.PackedBool4:
      case ExcelColumnDataType.PackedBool5:
      case ExcelColumnDataType.PackedBool6:
      case ExcelColumnDataType.PackedBool7:
        return this.readPackedBool(this.buffer.readUInt8(), column.type)
      default:
        throw new Error(`Unsupported column type: ${column.type}`)
    }
  }

  /**
   * Read string from buffer
   * @param rowOffset - the offset of the first column of a row
   * @returns string
   */
  private readString(rowOffset: number, columnValue: number): Buffer {
    this.buffer.readOffset = rowOffset + this.rowDataSize + columnValue
    return this.buffer.readBufferNT()
  }

  /**
   * Read packed bool from buffer
   * @param columnValue - the value of the column
   * @param type - the type of the column
   * @returns boolean
   */
  private readPackedBool(
    columnValue: number,
    type: ExcelColumnDataType,
  ): boolean {
    const shift = type - ExcelColumnDataType.PackedBool0
    return (columnValue & (1 << shift)) !== 0
  }
}
