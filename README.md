# SoundCloud API Frontend (Nuxt 4)

A Nuxt 4 frontend that searches SoundCloud tracks through a server API route.

## Setup

```bash
npm install
```

## Run locally

```bash
npm run dev
```

App will be available at `http://localhost:3000`.

## How it works

- UI form accepts a search query and SoundCloud `client_id`.
- Nuxt server route (`/api/soundcloud/search`) forwards requests to `https://api-v2.soundcloud.com/search/tracks`.
- Track results render as cards with artwork, metadata, and links to SoundCloud.
