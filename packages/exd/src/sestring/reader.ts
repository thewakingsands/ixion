import { readableBytes } from './format'
import {
  type Expression,
  ExpressionType,
  type Payload,
  type SeString,
} from './interface'
import { Type } from './type'

export const readExpression = (buffer: Buffer, from: number): Expression => {
  if (from < 0 || from >= buffer.length) {
    throw new Error(
      `Invalid expression position ${from} in buffer of length ${buffer.length}`,
    )
  }

  const type = buffer[from]
  if (type < 0xd0) {
    const length = 1
    return {
      type: ExpressionType.Integer,
      value: type - 1,
      length,
      buffer: buffer.subarray(from, from + length),
    }
  } else if ((type >= 0xd0 && type <= 0xdf) || type === 0xec) {
    const length = 1
    return {
      type: ExpressionType.Placeholder,
      value: type - 1,
      length,
      buffer: buffer.subarray(from, from + length),
    }
  } else if (type >= 0xe0 && type <= 0xe5) {
    const left = readExpression(buffer, from + 1)
    const right = readExpression(buffer, from + 1 + left.length)
    const length = 1 + left.length + right.length
    return {
      type: ExpressionType.Binary,
      comparison: type,
      left,
      right,
      length,
      buffer: buffer.subarray(from, from + length),
    }
  } else if (type >= 0xe8 && type <= 0xeb) {
    const length = 2
    return {
      type: ExpressionType.Parameter,
      kind: type,
      value: buffer[from + 1] - 1,
      length,
      buffer: buffer.subarray(from, from + length),
    }
  } else if (type >= 0xf0 && type <= 0xfe) {
    const typeByte = buffer[from] - 0xf0 + 1
    let value = 0
    let valueLength = 0

    if ((typeByte & 8) !== 0) {
      value += buffer[from + ++valueLength] * 256 * 256 * 256
    }

    if ((typeByte & 4) !== 0) {
      value += buffer[from + ++valueLength] * 256 * 256
    }

    if ((typeByte & 2) !== 0) {
      value += buffer[from + ++valueLength] * 256
    }

    if ((typeByte & 1) !== 0) {
      value += buffer[from + ++valueLength]
    }

    const length = valueLength + 1
    return {
      type: ExpressionType.Integer,
      value: value & 0xffffffff,
      length,
      buffer: buffer.subarray(from, from + length),
    }
  } else if (type === 0xff) {
    const lengthExp = readExpression(buffer, from + 1)
    if (lengthExp.type !== ExpressionType.Integer) {
      throw new Error('Length expression must be an integer')
    }

    const valueLength = lengthExp.value
    const length = 1 + lengthExp.length + valueLength
    return {
      type: ExpressionType.String,
      value: parseSeString(
        buffer.subarray(from + 1 + lengthExp.length, from + length),
      ),
      length,
      buffer: buffer.subarray(from, from + length),
    }
  } else {
    throw new Error(`Invalid expression type ${type.toString(16)}`)
  }
}

export const parseExpressions = (buffer: Buffer): Expression[] => {
  const expressions: Expression[] = []

  let cursor = 0
  while (cursor < buffer.length) {
    const expression = readExpression(buffer, cursor)
    expressions.push(expression)
    cursor = cursor + expression.length
  }

  if (cursor !== buffer.length) {
    throw new Error('Incorrect cursor position')
  }
  return expressions
}

export const readPayload = (buffer: Buffer, from: number): Payload => {
  const remaining = buffer.length - from
  if (remaining < 4) {
    throw new Error(
      `Not enough bytes remaining to read payload at position ${from}\nRemaining data: ${readableBytes(buffer.subarray(from))}`,
    )
  }

  const tagTypePos = from + 1
  const lengthExpPos = tagTypePos + 1

  const tagType = buffer[tagTypePos]
  const lengthExpression = readExpression(buffer, lengthExpPos)
  if (lengthExpression.type !== ExpressionType.Integer) {
    throw new Error('Length expression must be an integer')
  }

  const tagDataPos = lengthExpPos + lengthExpression.length
  const dataLength = lengthExpression.value
  const tagEndPos = tagDataPos + dataLength

  if (tagDataPos + dataLength > buffer.length) {
    throw new Error(
      `Data length ${dataLength} at position ${tagDataPos} is too large\nRemaining data: ${readableBytes(buffer.subarray(tagDataPos))}`,
    )
  }

  // start + type + length + data + end
  const payloadLength = 2 + lengthExpression.length + dataLength + 1

  if (buffer[tagEndPos] !== Type.PayloadEnd) {
    console.log(buffer.toString('base64'))
    console.log(buffer.subarray(from, tagEndPos + 1))
    throw new Error('Invalid tag end marker')
  }

  return {
    type: tagType,
    length: payloadLength,
    lengthExpression,
    buffer: buffer.subarray(from, tagEndPos),
    data:
      dataLength > 0
        ? parseExpressions(buffer.subarray(tagDataPos, tagEndPos))
        : [],
  }
}

export const parseSeString = (buffer: Buffer): SeString => {
  const parts: SeString = []

  let pos = 0
  let cursor = 0
  while (cursor < buffer.length) {
    if (buffer[cursor] !== Type.PayloadStart) {
      cursor++
      continue
    }

    // Push the static part
    if (pos !== cursor) {
      parts.push(buffer.subarray(pos, cursor).toString('utf-8'))
    }

    const payload = readPayload(buffer, cursor)
    parts.push(payload)

    pos = cursor + payload.length
    cursor = pos
  }

  if (pos !== buffer.length) {
    parts.push(buffer.subarray(pos).toString('utf-8'))
  }

  return parts
}
