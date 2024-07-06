import { ModelManager, createModel } from '../../src/index'

import knex from 'knex'

const connection = knex({
  client: 'sqlite3',
  connection: './db.sqlite3',
})

main()
async function main() {
  const hasTable = await connection.schema.hasTable('users')
  if (!hasTable) {
    await connection.schema.createTable('users', function (table) {
      table.increments('id')
      table.text('username')
      table.boolean('isActive').notNullable().defaultTo('true')
      table.timestamps(true, true)
    })
  }

  const User = createModel('User', {
    tableName: 'users',
    attributes: ['id', 'username', 'isActive'],
    relations: {},
    connection,
  })

  const user = User()
  const data = await user.findById(30)
  console.log(data)
}
