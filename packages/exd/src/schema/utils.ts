import { ExcelColumnDataType } from '@ffcafe/ixion-sqpack'

const typeMap: Record<ExcelColumnDataType, string> = {
  [ExcelColumnDataType.String]: 'str',
  [ExcelColumnDataType.Bool]: 'bool',
  [ExcelColumnDataType.Int8]: 'sbyte',
  [ExcelColumnDataType.UInt8]: 'byte',
  [ExcelColumnDataType.Int16]: 'int16',
  [ExcelColumnDataType.UInt16]: 'uint16',
  [ExcelColumnDataType.Int32]: 'int32',
  [ExcelColumnDataType.UInt32]: 'uint32',
  [ExcelColumnDataType.Unk]: 'unk',
  [ExcelColumnDataType.Int64]: 'int64',
  [ExcelColumnDataType.UInt64]: 'int64',
  [ExcelColumnDataType.Unk2]: 'unk',
  [ExcelColumnDataType.Float32]: 'single',
  [ExcelColumnDataType.PackedBool0]: 'bit&01',
  [ExcelColumnDataType.PackedBool1]: 'bit&02',
  [ExcelColumnDataType.PackedBool2]: 'bit&04',
  [ExcelColumnDataType.PackedBool3]: 'bit&08',
  [ExcelColumnDataType.PackedBool4]: 'bit&10',
  [ExcelColumnDataType.PackedBool5]: 'bit&20',
  [ExcelColumnDataType.PackedBool6]: 'bit&40',
  [ExcelColumnDataType.PackedBool7]: 'bit&80',
}

export function getSaintcoinachType(type: ExcelColumnDataType) {
  return typeMap[type]
}
