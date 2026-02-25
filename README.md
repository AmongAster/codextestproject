# Case Battle Arena Demo

A CaseBattle-style demo app that includes:

- Case list + opening battles with horizontal scrolling reel animation.
- API integration between frontend and backend.
- Admin panel to add items/skins to a case.
- Payment intent endpoint with external provider data integration (CoinGecko ETH/USD).

## Run

```bash
npm start
```

Open `http://localhost:3000`.

## Admin auth

Set `ADMIN_TOKEN` env var or use default `change-me-admin-token`.

## API endpoints

- `GET /api/cases`
- `POST /api/battle/spin` body: `{ "caseId": "starter-case" }`
- `POST /api/admin/items` header `x-admin-token`
- `POST /api/payment/create-intent` body: `{ "amountUsd": 20 }`
