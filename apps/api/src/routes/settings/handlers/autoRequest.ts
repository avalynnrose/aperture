/**
 * Auto-request rules support endpoints (admin only)
 *
 * - POST /api/settings/top-picks/auto-request/preview   Read-only plan of what an auto-request run would do
 * - GET  /api/settings/top-picks/auto-request/keywords  Search TMDB keywords (?q=)
 * - GET  /api/settings/top-picks/auto-request/genres    TMDB genre list (?mediaType=movie|tv)
 *
 * The preview builds the same plan the job executes. It only reads (library database, TMDB, Seerr
 * request status); nothing in this file can create a Seerr request.
 */
import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../../plugins/auth.js'

const adminOnly = { preHandler: requireAdmin }

export function registerAutoRequestHandlers(fastify: FastifyInstance) {
  fastify.post<{ Body?: { mediaTypes?: ('movie' | 'tv')[] } }>(
    '/api/settings/top-picks/auto-request/preview',
    {
      ...adminOnly,
      schema: {
        tags: ['settings'],
        summary: 'Preview auto-requests (read-only)',
        description:
          'Returns the plan the auto-request job would execute with the SAVED settings: ranked candidates with original rank, status, filter matches and exclusion reasons. Makes no Seerr requests and writes nothing.',
      },
    },
    async (request, reply) => {
      try {
        const { getTopPicksConfig, planAutoRequests } = await import('@aperture/core')
        const wanted = request.body?.mediaTypes?.length ? request.body.mediaTypes : (['movie', 'tv'] as const)
        const config = await getTopPicksConfig()
        const plans = []
        for (const type of wanted) {
          if (type !== 'movie' && type !== 'tv') return reply.status(400).send({ error: 'mediaTypes must be movie and/or tv' })
          plans.push(await planAutoRequests(type, config))
        }
        return reply.send({ generatedAt: new Date().toISOString(), staleAfterSeconds: 600, plans })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to build auto-request preview')
        return reply.status(500).send({ error: 'Failed to build the auto-request preview' })
      }
    }
  )

  fastify.get<{ Querystring: { q?: string } }>(
    '/api/settings/top-picks/auto-request/keywords',
    { ...adminOnly, schema: { tags: ['settings'], summary: 'Search TMDB keywords' } },
    async (request, reply) => {
      const { searchTmdbKeywords } = await import('@aperture/core')
      const result = await searchTmdbKeywords(request.query.q ?? '')
      if (!result.ok) return reply.status(502).send({ error: 'TMDB keyword search failed', detail: result.message })
      return reply.send({ results: result.results })
    }
  )

  fastify.get<{ Querystring: { mediaType?: string } }>(
    '/api/settings/top-picks/auto-request/genres',
    { ...adminOnly, schema: { tags: ['settings'], summary: 'TMDB genre list for a media type' } },
    async (request, reply) => {
      const mediaType = request.query.mediaType
      if (mediaType !== 'movie' && mediaType !== 'tv') return reply.status(400).send({ error: 'mediaType must be movie or tv' })
      const { getMovieGenresList, getTVGenresList } = await import('@aperture/core')
      const genres = mediaType === 'movie' ? await getMovieGenresList() : await getTVGenresList()
      if (genres.length === 0) return reply.status(502).send({ error: 'Could not load TMDB genres (is a TMDB API key configured?)' })
      return reply.send({ genres: genres.map((g) => ({ id: g.id, name: g.name })) })
    }
  )
}
