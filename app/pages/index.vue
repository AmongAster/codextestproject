<script setup lang="ts">
interface SoundCloudUser {
  username: string
  permalink_url?: string
}

interface SoundCloudTrack {
  id: number
  title: string
  duration: number
  permalink_url: string
  artwork_url?: string | null
  user: SoundCloudUser
}

interface SoundCloudSearchResponse {
  collection: SoundCloudTrack[]
  next_href?: string | null
}

const query = ref('lofi hip hop')
const clientId = ref('')
const isSubmitting = ref(false)
const searched = ref(false)
const tracks = ref<SoundCloudTrack[]>([])
const errorMessage = ref('')

const searchTracks = async () => {
  errorMessage.value = ''
  searched.value = true

  if (!clientId.value.trim()) {
    errorMessage.value = 'Enter your SoundCloud client ID to search tracks.'
    return
  }

  isSubmitting.value = true

  try {
    const response = await $fetch<SoundCloudSearchResponse>('/api/soundcloud/search', {
      query: {
        q: query.value,
        clientId: clientId.value,
        limit: 12
      }
    })

    tracks.value = response.collection ?? []

    if (!tracks.value.length) {
      errorMessage.value = 'No tracks found. Try another query.'
    }
  }
  catch (error) {
    tracks.value = []

    if (error instanceof Error && error.message) {
      errorMessage.value = error.message
      return
    }

    errorMessage.value = 'Unable to fetch tracks from SoundCloud.'
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <main class="container">
    <header>
      <h1>SoundCloud Search (Nuxt 4)</h1>
      <p>
        Search public SoundCloud tracks using your own API client ID.
      </p>
    </header>

    <form class="search-form" @submit.prevent="searchTracks">
      <label>
        Search
        <input v-model="query" name="query" type="text" placeholder="e.g. ambient focus" required>
      </label>

      <label>
        SoundCloud Client ID
        <input
          v-model="clientId"
          name="clientId"
          type="password"
          placeholder="Paste your SoundCloud client_id"
          required
        >
      </label>

      <button type="submit" :disabled="isSubmitting">
        {{ isSubmitting ? 'Searching…' : 'Search tracks' }}
      </button>
    </form>

    <p v-if="errorMessage" class="status error">{{ errorMessage }}</p>
    <p v-else-if="isSubmitting" class="status">Fetching tracks…</p>
    <p v-else-if="!searched" class="status">Run a search to load tracks.</p>

    <section v-if="tracks.length" class="grid">
      <TrackCard v-for="track in tracks" :key="track.id" :track="track" />
    </section>
  </main>
</template>
