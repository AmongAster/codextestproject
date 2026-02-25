interface SoundCloudSearchResponse {
  collection: unknown[]
  next_href?: string | null
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const q = String(query.q ?? '').trim()
  const clientId = String(query.clientId ?? '').trim()
  const limit = Number(query.limit ?? 12)

  if (!q) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required query parameter: q'
    })
  }

  if (!clientId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required query parameter: clientId'
    })
  }

  const config = useRuntimeConfig(event)
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 12

  try {
    return await $fetch<SoundCloudSearchResponse>(`${config.soundcloud.apiBase}/search/tracks`, {
      query: {
        q,
        client_id: clientId,
        limit: safeLimit,
        linked_partitioning: 1
      }
    })
  }
  catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: 'SoundCloud request failed',
      data: error
    })
  }
})
