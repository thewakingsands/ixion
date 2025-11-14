import type { Type } from './type'

// https://dalamud.dev/plugin-development/sestring/
export enum ExpressionType {
  Integer,
  Placeholder,
  Binary,
  Parameter,
  String,
}

export interface BaseExpression {
  type: ExpressionType
  length: number
  buffer: Buffer
}

export interface IntegerExpression extends BaseExpression {
  type: ExpressionType.Integer
  value: number
}

export interface PlaceholderExpression extends BaseExpression {
  type: ExpressionType.Placeholder
  value: number
}

export enum BinaryExpressionComparison {
  GreaterThanOrEqualTo = 0xe0,
  GreaterThan = 0xe1,
  LessThanOrEqualTo = 0xe2,
  LessThan = 0xe3,
  Equal = 0xe4,
  NotEqual = 0xe5,
}

export interface BinaryExpression extends BaseExpression {
  type: ExpressionType.Binary
  comparison: BinaryExpressionComparison
  left: Expression
  right: Expression
}

export enum ParameterType {
  LocalNumber = 0xe8,
  GlobalNumber = 0xe9,
  LocalString = 0xea,
  GlobalString = 0xeb,
}

export interface ParameterExpression extends BaseExpression {
  type: ExpressionType.Parameter
  kind: ParameterType
  value: number
}

export interface StringExpression extends BaseExpression {
  type: ExpressionType.String
  value: SeString
}

export type Expression =
  | IntegerExpression
  | PlaceholderExpression
  | BinaryExpression
  | ParameterExpression
  | StringExpression

export interface Payload {
  type: Type
  length: number
  lengthExpression: Expression
  buffer: Buffer
  data: Expression[]
}

export type SeString = Array<string | Payload>
