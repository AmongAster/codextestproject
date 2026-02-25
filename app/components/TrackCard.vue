<script setup lang="ts">
interface SoundCloudUser {
  username: string
  permalink_url?: string
}

interface SoundCloudArtwork {
  artwork_url?: string | null
}

interface SoundCloudTrack extends SoundCloudArtwork {
  id: number
  title: string
  duration: number
  permalink_url: string
  user: SoundCloudUser
}

defineProps<{
  track: SoundCloudTrack
}>()

const formatDuration = (durationInMs: number) => {
  const totalSeconds = Math.floor(durationInMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
</script>

<template>
  <article class="track-card">
    <img
      :src="track.artwork_url || 'https://placehold.co/320x320/111827/F9FAFB?text=No+Artwork'"
      :alt="`${track.title} artwork`"
      class="track-cover"
      loading="lazy"
    >

    <div class="track-content">
      <p class="track-meta">{{ formatDuration(track.duration) }}</p>
      <h3>{{ track.title }}</h3>
      <p>{{ track.user.username }}</p>

      <a :href="track.permalink_url" target="_blank" rel="noopener noreferrer">
        Open on SoundCloud
      </a>
    </div>
  </article>
</template>
