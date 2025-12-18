import $debug from 'debug'
import {
  type BinaryExpression,
  BinaryExpressionComparison,
  type Expression,
  ExpressionType,
  type ParameterExpression,
  ParameterType,
  type Payload,
  type SeString,
} from './interface'
import { Type } from './type'

const debug = $debug('ixion:exd:sestring:format')

const unknownTagSet = new Set<number>()
const reportUnknownTag = (tag: number) => {
  if (unknownTagSet.has(tag)) {
    return
  }

  unknownTagSet.add(tag)
  debug('Unknown tag type %s: %s', tag, Type[tag])
}

export interface FormatOptions {
  debug?: boolean
  renderToText?: boolean
  ifBranch?: boolean
  lineBreak?: string
}

export const readableByte = (byte: number): string => {
  return byte.toString(16).padStart(2, '0')
}

export const readableBytes = (buffer: Buffer) => {
  const result = []
  for (let i = 0; i < buffer.length; i++) {
    result.push(buffer[i].toString(16).padStart(2, '0'))
  }
  return result.join(' ')
}

export const formatHexValueTag = (tagName: string, tagData: Buffer) => {
  return `<${tagName}>${tagData.toString('hex').toUpperCase()}</${tagName}>`
}

export const formatNormalTag = (
  tagName: string,
  expressions: Expression[],
  options: FormatOptions,
) => {
  return `<${tagName}>${expressions.map((expression) => formatExpression(expression, options)).join('')}</${tagName}>`
}

export const formatSelfClosingTag = (
  tagName: string,
  expressions: Expression[],
  options: FormatOptions,
) => {
  return `<${tagName}(${expressions.map((expression) => formatExpression(expression, options)).join(',')})/>`
}

export const formatBinaryExpression = (
  { comparison, left, right }: BinaryExpression,
  options: FormatOptions,
): string => {
  switch (comparison) {
    case BinaryExpressionComparison.GreaterThanOrEqualTo:
      return `GreaterThanOrEqualTo(${formatExpression(left, options)},${formatExpression(right, options)})`
    case BinaryExpressionComparison.GreaterThan:
      return `GreaterThan(${formatExpression(left, options)},${formatExpression(right, options)})`
    case BinaryExpressionComparison.LessThanOrEqualTo:
      return `LessThanOrEqualTo(${formatExpression(left, options)},${formatExpression(right, options)})`
    case BinaryExpressionComparison.LessThan:
      return `LessThan(${formatExpression(left, options)},${formatExpression(right, options)})`
    case BinaryExpressionComparison.Equal:
      return `Equal(${formatExpression(left, options)},${formatExpression(right, options)})`
    case BinaryExpressionComparison.NotEqual:
      return `NotEqual(${formatExpression(left, options)},${formatExpression(right, options)})`
    default:
      throw new Error(`Invalid binary expression comparison ${comparison}`)
  }
}

export const formatParameterExpression = ({
  kind,
  value,
}: ParameterExpression): string => {
  switch (kind) {
    case ParameterType.LocalNumber:
      return `IntegerParameter(${value})`
    case ParameterType.GlobalNumber:
      return `PlayerParameter(${value})`
    case ParameterType.LocalString:
      return `StringParameter(${value})`
    case ParameterType.GlobalString:
      return `ObjectParameter(${value})`
    default:
      throw new Error(`Invalid parameter type ${kind}`)
  }
}

export const formatExpression = (
  expression: Expression,
  options: FormatOptions,
): string => {
  switch (expression.type) {
    case ExpressionType.Binary:
      return formatBinaryExpression(expression, options)
    case ExpressionType.Integer:
      return options.debug
        ? `Integer(${expression.value.toString()})`
        : expression.value.toString()
    case ExpressionType.String:
      return options.debug
        ? `String(${formatSeString(expression.value)})`
        : formatSeString(expression.value, options)
    case ExpressionType.Placeholder:
      return `TopLevelParameter(${expression.value})`
    case ExpressionType.Parameter:
      return formatParameterExpression(expression)
    default:
      throw new Error(
        `Invalid expression type ${(expression as Expression).type}`,
      )
  }
}

export const formatPayloadForError = (payload: Payload) => {
  return [
    'Expressions:',
    ...payload.data.map((exp) => `  ${formatExpression(exp, { debug: true })}`),
    'Bytecode trace:',
    `${readableByte(payload.buffer[0])} - Start of tag`,
    `  ${readableByte(payload.type)} - Type: ${Type[payload.type]}`,
    `  ${readableBytes(payload.lengthExpression.buffer)} - Length: ${formatExpression(payload.lengthExpression, { debug: true })}`,
    ...payload.data.map(
      (exp) =>
        `  ${readableBytes(exp.buffer)} - ${formatExpression(exp, { debug: true })}`,
    ),
    `${readableByte(payload.buffer[payload.buffer.length - 1])} - End of tag`,
  ].join('\n')
}

export function formatSeString(
  seString: SeString,
  options: FormatOptions = {},
): string {
  const parts: string[] = []

  for (const payload of seString) {
    if (typeof payload === 'string') {
      parts.push(payload)
      continue
    }

    const payloadType = payload.type
    const tagName = Type[payloadType] || `${payloadType}`
    if (payload.data.length === 0) {
      if (payloadType === Type.LineBreak) {
        parts.push(options.lineBreak || '\r\n')
      } else if (options.renderToText) {
        switch (payloadType) {
          case Type.SoftHyphen:
            parts.push('-')
            break
        }
      } else {
        parts.push(`<${tagName}/>`)
      }

      continue
    }

    try {
      switch (payloadType) {
        // SaintCoinach formats SeString as a string with hex values for certain tags
        case Type.Fixed:
        case Type.ResetTime:
        case Type.UIForeground:
        case Type.UIGlow:
        case Type.Unknown0A:
        case Type.Unknown14:
        case Type.Unknown17:
        case Type.Unknown2D:

        case Type.Unknown60:
        // Known unhandled tags
        case 27 as Type:
        case 28 as Type:
        case 38 as Type:
        case 65 as Type:
        case 66 as Type:
        case 81 as Type:
        case 97 as Type:
          if (!options.renderToText) {
            parts.push(
              formatHexValueTag(
                tagName,
                payload.buffer.subarray(3, payload.length - 1),
              ),
            )
          }
          break
        case Type.If: {
          if (payload.data.length !== 3) {
            throw new Error(
              `If tag must have 3 expressions, got ${payload.data.length}`,
            )
          }
          const [condition, trueValue, falseValue] = payload.data
          if (options.ifBranch === true) {
            parts.push(formatExpression(trueValue, options))
          } else if (options.ifBranch === false) {
            parts.push(formatExpression(falseValue, options))
          } else {
            parts.push(
              `<${tagName}(${formatExpression(condition, options)})>${formatExpression(trueValue, options)}<Else/>${formatExpression(falseValue, options)}</${tagName}>`,
            )
          }
          break
        }
        case Type.Switch:
          if (payload.data.length < 2) {
            throw new Error(
              `Switch tag must have at least 2 expressions, got ${payload.data.length}`,
            )
          }

          parts.push(
            `<${tagName}(${formatExpression(payload.data[0], options)})>`,
          )
          for (let i = 1; i < payload.data.length; i++) {
            parts.push(
              `<Case(${i})>${formatExpression(payload.data[i], options)}</Case>`,
            )
          }
          parts.push(`</${tagName}>`)
          break
        case Type.Color: {
          if (payload.data.length !== 1) {
            throw new Error(
              `Color tag must have 1 expression, got ${payload.data.length}`,
            )
          }

          if (!options.renderToText) {
            const expression = payload.data[0]
            if (expression.type === ExpressionType.Placeholder) {
              parts.push(`</${tagName}>`)
            } else {
              parts.push(
                `<${tagName}(${formatExpression(expression, options)})>`,
              )
            }
          }
          break
        }
        case Type.Value:
        case Type.Highlight:
        case Type.TwoDigitValue:
          parts.push(formatNormalTag(tagName, payload.data, options))
          break
        case Type.CommandIcon:
        case Type.Clickable:
        case Type.Gui:
        case Type.Time:
        case Type.Sheet:
        case Type.SheetDe:
        case Type.SheetEn:
        case Type.SheetFr:
        case Type.SheetJa:
        case Type.Split:
          if (!options.renderToText) {
            parts.push(formatSelfClosingTag(tagName, payload.data, options))
          }
          break
        case Type.ZeroPaddedValue: {
          if (payload.data.length !== 2) {
            throw new Error(
              `Format tag must have 2 expressions, got ${payload.data.length}`,
            )
          }

          const [value, length] = payload.data
          parts.push(
            `<${tagName}(${formatExpression(length, options)})>${formatExpression(value, options)}</${tagName}>`,
          )
          break
        }
        case Type.Format: {
          if (payload.data.length !== 2) {
            throw new Error(
              `Format tag must have 2 expressions, got ${payload.data.length}`,
            )
          }

          const [arg, data] = payload.data
          parts.push(
            `<${tagName}(${formatExpression(arg, options)},${data.buffer.toString('hex').toUpperCase()})/>`,
          )
          break
        }
        case Type.Emphasis: {
          if (payload.data.length !== 1) {
            throw new Error(
              `Emphasis tag must have 1 expression, got ${payload.data.length}`,
            )
          }

          const expression = payload.data[0]
          if (expression.type !== ExpressionType.Integer) {
            throw new Error(
              `Emphasis tag must have an integer expression, got ${expression.type}`,
            )
          }

          const enabled = expression.value === 1
          parts.push(enabled ? `<${tagName}>` : `</${tagName}>`)
          break
        }
        default:
          reportUnknownTag(payloadType)
          if (!options.renderToText) {
            parts.push(
              formatHexValueTag(
                tagName,
                payload.buffer.subarray(3, payload.length - 1),
              ),
            )
          }
          break
      }
    } catch (error: unknown) {
      throw new SeStringError('FormatError', payload, error)
    }
  }
  return parts.join('')
}

export class SeStringError extends Error {
  constructor(message: string, payload: Payload, cause: unknown) {
    super(`${message}\n${formatPayloadForError(payload)}`, { cause })
    this.name = 'SeStringError'
  }
}
