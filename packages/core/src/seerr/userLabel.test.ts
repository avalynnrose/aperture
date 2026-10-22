import assert from 'node:assert/strict'
import { test } from 'node:test'
import { seerrUserLabel } from './userLabel.js'

test('prefers display name, then username, then media-server names, then email', () => {
  assert.equal(seerrUserLabel({ id: 1, displayName: 'Display', username: 'u', jellyfinUsername: 'j' }), 'Display')
  assert.equal(seerrUserLabel({ id: 1, displayName: null, username: 'u', jellyfinUsername: 'j' }), 'u')
  assert.equal(seerrUserLabel({ id: 1, username: '', jellyfinUsername: 'jelly' }), 'jelly')
  assert.equal(seerrUserLabel({ id: 1, username: '  ', plexUsername: 'plexy' }), 'plexy')
  assert.equal(seerrUserLabel({ id: 1, username: '', email: 'a@example.invalid' }), 'a@example.invalid')
})

test('falls back to a generic label when no name exists, never to the bare number', () => {
  assert.equal(seerrUserLabel({ id: 7, username: '' }), 'User 7')
})

test('trims whitespace-only names', () => {
  assert.equal(seerrUserLabel({ id: 2, displayName: '   ', username: 'real' }), 'real')
})
