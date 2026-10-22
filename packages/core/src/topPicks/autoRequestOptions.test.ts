import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertValidRequesterId, assertValidSeasonMode, buildAutoRequestOptions, resolveRequester } from './autoRequestOptions.js'

const users = [{ id: 1 }, { id: 6 }]

test('no requester configured keeps upstream behavior', () => {
  assert.deepEqual(resolveRequester(null, users), { status: 'default' })
  assert.deepEqual(resolveRequester(undefined, []), { status: 'default' })
})

test('configured requester that exists is ok', () => {
  assert.deepEqual(resolveRequester(6, users), { status: 'ok', userId: 6 })
})

test('deleted requester is reported as missing, never replaced', () => {
  assert.deepEqual(resolveRequester(9, users), { status: 'missing', userId: 9 })
})

test('empty user list means unverified, not missing', () => {
  assert.deepEqual(resolveRequester(6, []), { status: 'unverified', userId: 6 })
})

test('requester applies to both movies and TV', () => {
  const s = { requesterUserId: 6, seriesSeasons: 'all' as const }
  assert.deepEqual(buildAutoRequestOptions('movie', s), { userId: 6 })
  assert.deepEqual(buildAutoRequestOptions('tv', s), { userId: 6 })
})

test('defaults send no user id and no seasons', () => {
  const s = { requesterUserId: null, seriesSeasons: 'all' as const }
  assert.deepEqual(buildAutoRequestOptions('movie', s), {})
  assert.deepEqual(buildAutoRequestOptions('tv', s), {})
})

test('season mode first only affects TV and is independent of requester', () => {
  const s = { requesterUserId: null, seriesSeasons: 'first' as const }
  assert.deepEqual(buildAutoRequestOptions('movie', s), {})
  assert.deepEqual(buildAutoRequestOptions('tv', s), { seasons: [1] })
  const both = { requesterUserId: 6, seriesSeasons: 'first' as const }
  assert.deepEqual(buildAutoRequestOptions('tv', both), { userId: 6, seasons: [1] })
})

test('requester id validation accepts null and positive integers only', () => {
  assert.doesNotThrow(() => assertValidRequesterId(null))
  assert.doesNotThrow(() => assertValidRequesterId(6))
  for (const bad of [0, -5, 1.5, '6', undefined, NaN]) {
    assert.throws(() => assertValidRequesterId(bad), /autoRequestSeerrUserId must be/)
  }
})

test('season mode validation accepts all|first only', () => {
  assert.doesNotThrow(() => assertValidSeasonMode('all'))
  assert.doesNotThrow(() => assertValidSeasonMode('first'))
  for (const bad of ['bogus', '', null, undefined, 1]) {
    assert.throws(() => assertValidSeasonMode(bad), /seriesAutoRequestSeasons must be/)
  }
})
