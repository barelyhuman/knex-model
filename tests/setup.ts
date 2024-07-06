import knex from 'knex'

export const mockConnection = knex({
  client: 'sqlite3',
  connection: ':memory:',
  useNullAsDefault: true,
})

export async function clearTables() {
  await truncateIfExists('users')
}

async function truncateIfExists(tableName: string) {
  if (await mockConnection.schema.hasTable(tableName)) {
    await mockConnection(tableName).truncate()
  }
}

export async function setup() {
  if (!(await mockConnection.schema.hasTable('users'))) {
    await mockConnection.schema.createTable('users', function (table) {
      table.increments('id')
      table.boolean('isActive').defaultTo(true).notNullable()
      table.text('username').notNullable().unique()
    })
  }
}

export const testContext = {}
