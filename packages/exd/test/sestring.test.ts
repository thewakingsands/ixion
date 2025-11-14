import { describe, expect, it } from 'vitest'
import { formatSeString, parseSeString, Type } from '../src/sestring'
import { ExpressionType, ParameterType } from '../src/sestring/interface'
import { parseExpressions } from '../src/sestring/reader'

describe('expressions', () => {
  it('should parse simple integer', () => {
    const result = parseExpressions(Buffer.from('04', 'hex'))
    expect(result).toMatchObject([{ type: ExpressionType.Integer, value: 3 }])
  })
  it('should parse complex integer', () => {
    const result = parseExpressions(Buffer.from('F60493E0', 'hex'))
    expect(result).toMatchObject([
      { type: ExpressionType.Integer, value: 300000 },
    ])
  })
  it('should parse placeholder', () => {
    const result = parseExpressions(Buffer.from('D8', 'hex'))
    expect(result).toMatchObject([
      { type: ExpressionType.Placeholder, value: 0xd8 - 1 },
    ])
  })
  it('should parse binary expression', () => {
    const result = parseExpressions(Buffer.from('E40202', 'hex'))
    expect(result).toMatchObject([
      {
        type: ExpressionType.Binary,
        comparison: 0xe4,
        left: { type: ExpressionType.Integer, value: 1 },
        right: { type: ExpressionType.Integer, value: 1 },
      },
    ])
  })
  it('should parse parameter expression', () => {
    const result = parseExpressions(Buffer.from('E801', 'hex'))
    expect(result).toMatchObject([
      { type: ExpressionType.Parameter, kind: 0xe8, value: 0 },
    ])
  })
  it('should parse string expression', () => {
    const result = parseExpressions(Buffer.from('FF07022903EB0203', 'hex'))
    expect(result).toMatchObject([
      {
        type: ExpressionType.String,
        value: [
          {
            type: Type.Highlight,
            data: [
              {
                type: ExpressionType.Parameter,
                kind: ParameterType.GlobalString,
                value: 1,
              },
            ],
          },
        ],
      },
    ])
  })
})

describe('sestring', () => {
  it('should parse ActionTransient#9', () => {
    const input = Buffer.from(
      '5a+555uu5qCH5Y+R5Yqo54mp55CG5pS75Ye744CAAkgE8gH4AwJJBPIB+QPlqIHlipvvvJoCSQIBAwJIAgEDAgg/5OlFFP8iAgge4OlJX/Dc/xYCCBLk6UUU/wsCCAfg6UlVyZcDlwMD/xYCCBLk6UUU/wsCCAfg6UlVyZcDlwMD',
      'base64',
    )
    const expected =
      '对目标发动物理攻击　<UIForeground>F201F8</UIForeground><UIGlow>F201F9</UIGlow>威力：<UIGlow>01</UIGlow><UIForeground>01</UIForeground><If(Equal(PlayerParameter(68),19))><If(GreaterThanOrEqualTo(PlayerParameter(72),94))>220<Else/><If(Equal(PlayerParameter(68),19))><If(GreaterThanOrEqualTo(PlayerParameter(72),84))>200<Else/>150</If><Else/>150</If></If><Else/><If(Equal(PlayerParameter(68),19))><If(GreaterThanOrEqualTo(PlayerParameter(72),84))>200<Else/>150</If><Else/>150</If></If>'

    const result = parseSeString(input)
    expect(formatSeString(result)).toEqual(expected)
  })
})
