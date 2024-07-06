import { test } from 'uvu'
import * as assert from 'uvu/assert'
import { createModel } from '../src/index'
import { clearTables, mockConnection, setup } from './setup'

test.before(async () => {
  await setup()
})

test.after(async () => {
  await mockConnection.destroy()
})

const User = createModel('User', {
  tableName: 'users',
  attributes: ['id', 'username', 'isActive'],
  connection: mockConnection,
})

test.before.each(async () => {
  await clearTables()
})

test('insert', async () => {
  const user = User({
    isActive: true,
    username: 'testName',
  })
  await user.save()
  assert.equal(user.id, 1)
})

test('update', async () => {
  const user = User({
    isActive: true,
    username: 'testName',
  })
  await user.save()
  assert.equal(user.id, 1)
  assert.equal(user.username, 'testName')
  user.username = 'newName'
  await user.save()
  assert.equal(user.id, 1)
  assert.equal(user.username, 'newName')
})

test('refresh / resync', async () => {
  const user = User({
    isActive: true,
    username: 'testName',
  })
  await user.save()
  assert.equal(user.id, 1)
  assert.equal(user.username, 'testName')

  // change to something random
  user.username = 'newName'

  // resync user from database
  await user.refresh()
  assert.equal(user.id, 1)
  assert.equal(user.username, 'testName')
})

test('toJSON', async () => {
  const user = User({
    isActive: true,
    username: 'testName',
  })
  // should be missing the `id`
  assert.snapshot(
    JSON.stringify(user.toJSON()),
    '{"isActive":true,"username":"testName"}'
  )

  // should have the id post saving
  await user.save()
  assert.snapshot(
    JSON.stringify(user.toJSON()),
    '{"id":1,"username":"testName","isActive":1}'
  )
})

test.run()
