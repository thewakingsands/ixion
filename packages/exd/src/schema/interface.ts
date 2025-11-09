import { z } from 'zod'

/** /^\w+$/ reusable */
const Ident = z.string().trim().regex(/^\w+$/)

/** Relations */
export const RelationsSchema = z.record(Ident, z.array(Ident))

/** BaseField */
export const BaseFieldSchema = z.object({
  comment: z.string().optional(),
  type: z.enum(['scalar', 'link', 'array', 'icon', 'modelId', 'color']),
})

/** Scalar */
export const ScalarFieldSchema = BaseFieldSchema.extend({
  type: z.literal('scalar').optional(),
})

/** Link */
export const LinkFieldSchema = BaseFieldSchema.extend({
  type: z.literal('link'),
  targets: z.array(Ident).min(1).optional(),
  condition: z
    .object({
      switch: Ident,
      cases: z.record(z.string().regex(/^\d+$/), z.array(Ident).min(1)),
    })
    .optional(),
})

/** Array */
export const ArrayFieldSchema = BaseFieldSchema.extend({
  type: z.literal('array'),
  count: z.number().positive(),
  relations: RelationsSchema.optional(),
  fields: z.array(z.unknown()).min(1).optional(),
})

/** Icon */
export const IconFieldSchema = BaseFieldSchema.extend({
  type: z.literal('icon'),
})

/** ModelId */
export const ModelIdFieldSchema = BaseFieldSchema.extend({
  type: z.literal('modelId'),
})

/** Color */
export const ColorFieldSchema = BaseFieldSchema.extend({
  type: z.literal('color'),
})

/** Field = discriminated union by `type` */
export const FieldSchema = z.discriminatedUnion('type', [
  ScalarFieldSchema,
  LinkFieldSchema,
  ArrayFieldSchema,
  IconFieldSchema,
  ModelIdFieldSchema,
  ColorFieldSchema,
])

export const UnnamedFieldSchema = FieldSchema

/** NamedField = Field + name */
export const NamedFieldSchema = z.intersection(
  FieldSchema,
  z.object({
    name: Ident,
  }),
)

/** Top-level schema */
export const EXDSchema = z.object({
  name: Ident,
  displayField: Ident.optional(),
  fields: z.array(NamedFieldSchema).min(1),
  relations: RelationsSchema.optional(),
})

// types
export type UnnamedFieldSchema = z.infer<typeof UnnamedFieldSchema>
export type NamedFieldSchema = z.infer<typeof NamedFieldSchema>
export type EXDSchema = z.infer<typeof EXDSchema>
