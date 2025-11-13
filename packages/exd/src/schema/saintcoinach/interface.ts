import { z } from 'zod'

const DataBase = z.object({
  index: z.number().optional(),
})

export const SingleData = DataBase.extend({
  type: z.literal(undefined),
  name: z.string(),
  converter: z.any().optional(),
})

export const GroupData = DataBase.extend({
  type: z.literal('group'),
  // z.unknown() is used because the members can be any type of data
  members: z.array(z.unknown()),
})

export const RepeatData = DataBase.extend({
  type: z.literal('repeat'),
  count: z.number(),
  // z.unknown() is used because the definition can be any type of data
  definition: z.unknown(),
})

export const Data = z.discriminatedUnion('type', [
  SingleData,
  GroupData,
  RepeatData,
])

export const DefinitionSchema = z.object({
  sheet: z.string(),
  defaultColumn: z.string(),
  definitions: z.array(Data),
})
