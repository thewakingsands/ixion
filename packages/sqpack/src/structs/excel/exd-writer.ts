import { SmartBuffer } from 'smart-buffer'
import {
  excelDataHeaderSizeWithoutOffsetMap,
  excelDataOffsetSize,
  excelDataRowHeaderSize,
  type IExdDataRow,
  subRowIdSize,
  writeExcelDataHeader,
  writeExcelDataRowHeader,
} from './exd'
import {
  type ExcelColumn,
  ExcelColumnDataType,
  ExcelVariant,
  type ExhHeader,
} from './exh'

interface IWriteColumnContext {
  buffer: Buffer
  rowOffset: number
  stringOffset: number
  stringBuffer: SmartBuffer
}

export class EXDWriter {
  /* RowId to offset map, without header size */
  private offsetMap: Map<number, number> = new Map()
  private rowDataSize: number
  private variant: ExcelVariant
  private columns: ExcelColumn[]

  private buffer: SmartBuffer

  constructor(exhHeader: ExhHeader) {
    this.buffer = new SmartBuffer()
    this.rowDataSize = exhHeader.dataOffset
    this.variant = exhHeader.variant
    this.columns = exhHeader.columns
  }

  get isSubrows(): boolean {
    return this.variant === ExcelVariant.Subrows
  }

  output(): Buffer {
    const indexSize = this.offsetMap.size * excelDataOffsetSize
    const headerSize = indexSize + excelDataHeaderSizeWithoutOffsetMap

    const headerBuffer = SmartBuffer.fromSize(headerSize)
    const headerOffsetMap = new Map<number, number>()
    for (const [rowId, offset] of this.offsetMap) {
      headerOffsetMap.set(rowId, offset + headerSize)
    }

    writeExcelDataHeader(headerBuffer, {
      magic: 'EXDF',
      version: 2,
      u1: 0,
      indexSize,
      dataSize: this.buffer.writeOffset,
      offsetMap: headerOffsetMap,
    })

    return Buffer.concat([headerBuffer.toBuffer(), this.buffer.toBuffer()])
  }

  writeRows(rows: IExdDataRow[]) {
    for (const row of rows) {
      this.writeRow(row)
    }
  }

  writeRow(row: IExdDataRow) {
    const rowCount = this.isSubrows ? row.data.length : 1
    const dataSize = this.isSubrows
      ? rowCount * (this.rowDataSize + subRowIdSize)
      : this.rowDataSize

    const dataBuffer = Buffer.alloc(dataSize)
    const stringBuffer = new SmartBuffer()

    if (this.isSubrows) {
      for (let i = 0; i < rowCount; i++) {
        const subRowStart = i * (this.rowDataSize + subRowIdSize)
        const subRowDataStart = subRowStart + subRowIdSize
        const { subRowId, data } = row.data[i]

        // write sub row id
        dataBuffer.writeUInt16BE(subRowId, subRowStart)

        // write sub row data
        this.writeColumns(
          {
            buffer: dataBuffer,
            rowOffset: subRowDataStart,
            stringOffset: dataSize - subRowDataStart - this.rowDataSize,
            stringBuffer,
          },
          data,
        )
      }
    } else {
      this.writeColumns(
        {
          buffer: dataBuffer,
          rowOffset: 0,
          stringOffset: 0,
          stringBuffer,
        },
        row.data,
      )
    }

    // record offset
    this.offsetMap.set(row.rowId, this.buffer.writeOffset)

    // write row header
    const totalSize = dataSize + stringBuffer.length
    const alignTo = 4
    // not sure
    let padding =
      alignTo -
      ((totalSize + (this.isSubrows ? 0 : excelDataRowHeaderSize)) % alignTo)
    if (padding === alignTo) {
      padding = 0
    }

    writeExcelDataRowHeader(this.buffer, {
      dataSize: totalSize + padding,
      rowCount,
    })

    // write data
    this.buffer.writeBuffer(dataBuffer)

    // write strings
    if (stringBuffer.length > 0) {
      this.buffer.writeBuffer(stringBuffer.toBuffer())
    }

    if (padding > 0) {
      this.buffer.writeBuffer(Buffer.alloc(padding, 0))
    }
  }

  private writeColumns(ctx: IWriteColumnContext, data: any[]) {
    if (data.length !== this.columns.length) {
      throw new Error(
        `Expected ${this.columns.length} columns, got ${data.length}`,
      )
    }

    try {
      for (let i = 0; i < data.length; i++) {
        this.writeColumn(ctx, this.columns[i], data[i])
      }
    } catch (error) {
      throw new Error(
        `Failed to write columns, data: ${JSON.stringify(data)}`,
        { cause: error },
      )
    }
  }

  private writeString(ctx: IWriteColumnContext, value: string) {
    const columnValue = ctx.stringBuffer.writeOffset + ctx.stringOffset

    if (typeof value === 'string') {
      ctx.stringBuffer.writeStringNT(value)
    } else if (Buffer.isBuffer(value)) {
      ctx.stringBuffer.writeBufferNT(value)
    } else {
      throw new Error(`Unsupported value type: ${typeof value}`)
    }
    return columnValue
  }

  private writeColumn(
    ctx: IWriteColumnContext,
    column: ExcelColumn,
    value: any,
  ) {
    const { buffer } = ctx
    const offset = ctx.rowOffset + column.offset
    switch (column.type) {
      case ExcelColumnDataType.String: {
        const columnValue = this.writeString(ctx, value)
        buffer.writeUInt32BE(columnValue, offset)
        break
      }
      case ExcelColumnDataType.Bool:
        buffer.writeUInt8(value ? 1 : 0, offset)
        break
      case ExcelColumnDataType.Int8:
        buffer.writeInt8(value, offset)
        break
      case ExcelColumnDataType.UInt8:
        buffer.writeUInt8(value, offset)
        break
      case ExcelColumnDataType.Int16:
        buffer.writeInt16BE(value, offset)
        break
      case ExcelColumnDataType.UInt16:
        buffer.writeUInt16BE(value, offset)
        break
      case ExcelColumnDataType.Int32:
        buffer.writeInt32BE(value, offset)
        break
      case ExcelColumnDataType.UInt32:
        buffer.writeUInt32BE(value, offset)
        break
      case ExcelColumnDataType.Float32:
        buffer.writeFloatBE(value, offset)
        break
      case ExcelColumnDataType.Int64:
        buffer.writeBigInt64BE(value, offset)
        break
      case ExcelColumnDataType.UInt64:
        buffer.writeBigUInt64BE(value, offset)
        break
      case ExcelColumnDataType.PackedBool0:
      case ExcelColumnDataType.PackedBool1:
      case ExcelColumnDataType.PackedBool2:
      case ExcelColumnDataType.PackedBool3:
      case ExcelColumnDataType.PackedBool4:
      case ExcelColumnDataType.PackedBool5:
      case ExcelColumnDataType.PackedBool6:
      case ExcelColumnDataType.PackedBool7:
        this.writePackedBool(buffer, offset, column.type, !!value)
        break
      default:
        throw new Error(`Unsupported column type: ${column.type}`)
    }
  }

  private writePackedBool(
    buffer: Buffer,
    offset: number,
    type: ExcelColumnDataType,
    value: boolean,
  ) {
    // If the value is false, do nothing
    if (!value) return

    const shift = type - ExcelColumnDataType.PackedBool0
    buffer.writeUInt8(buffer.readUInt8(offset) | (1 << shift), offset)
  }
}
