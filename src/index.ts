import type { Knex } from 'knex'

export type Options<Attribute extends string> = {
  tableName: string
  attributes: Attribute[]
  relations?: object
  connection: Knex
}

export type Event = 'load' | 'save'
export type Action = 'insert' | 'update' | undefined
export type ModelContext<T> = {
  tableName: string
  name: string
  action: Action
  data: T
}
export type EventHandler = <T>(context: ModelContext<T>) => void | Promise<void>

const modelRegister = new Map()
const handlers: { event: Event; handler: EventHandler }[] = []

const dispatch = async <T>(event: Event, ctx: ModelContext<T>) => {
  for (let handlerDef of handlers) {
    if (handlerDef.event === event) {
      await handlerDef.handler(ctx)
    }
  }
}
export const ModelManager = {
  on: (event: 'load' | 'save', handler: (modelCtx: any) => void) => {
    handlers.push({
      event,
      handler,
    })
  },
}

type ModelActor<T extends string | number | symbol, M> = {
  save: () => Promise<void>
  refresh: () => Promise<void>
  toJSON: () => Record<T, M>
  findById: (id: any) => Promise<Record<T, M>>
} & {
  [k in T]: M
}

export function createModel<T extends 'id' | string, M extends any>(
  modelName: string,
  { tableName, attributes, relations, connection }: Options<T>
) {
  let _conn = connection
  const qb = () => _conn(tableName)
  modelRegister.set(modelName, { name: modelName, tableName })
  return (data?: Omit<Partial<Record<T, M>>, 'id'>): ModelActor<T, M> => {
    let _internal = copy(data || {}) as Record<T, M>

    async function __refresh() {
      if (_internal.id) {
        const result = await qb()
          .where({
            id: _internal.id,
          })
          .select(attributes.map(d => `${tableName}.${d}`))
          .first()
        _internal = result
        await dispatch('load', {
          data: _internal,
          name: modelName,
          tableName: tableName,
          action: undefined,
        })
      }
    }

    const originalObject = {
      async refresh() {
        await __refresh()
      },
      async findById(id: string) {
        _internal.id = id
        await __refresh()
        return _internal
      },
      toJSON() {
        return copy(_internal)
      },
      async save() {
        const isInsert = !('id' in _internal)
        await dispatch('save', {
          data: _internal,
          name: modelName,
          tableName: tableName,
          action: isInsert ? 'insert' : 'update',
        })
        if ('id' in _internal) {
          const result = await qb()
            .update({
              ..._internal,
              id: undefined,
            })
            .where({
              id: _internal.id,
            })
            .returning(['id'])
          _internal = takeFirst(result)
          await __refresh()
          return
        }
        const result = await qb().insert(_internal).returning(['id'])
        _internal = takeFirst(result)
        await __refresh()
        return
      },
    }
    const dataProxy = new Proxy(originalObject, {
      get(target, p: T, receiver) {
        if (Object.keys(originalObject).includes(p)) {
          return Reflect.get(target, p, receiver)
        }
        return _internal[p]
      },
      set(_, p: T, newValue) {
        if (Object.keys(originalObject).includes(p)) {
          return false
        }
        _internal[p] = newValue
        return true
      },
    })
    return dataProxy as ModelActor<T, M>
  }
}

function copy<T>(obj: T) {
  const props = Object.getOwnPropertyDescriptors(obj)
  const newObj = {}
  Object.defineProperties(newObj, props)
  return newObj
}

function takeFirst<T>(items: T[]): T {
  return [].concat(items as any).slice(0, 1)[0] ?? undefined
}
