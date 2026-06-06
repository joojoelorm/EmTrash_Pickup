# Emtrash Pickup

Static prototype for resident waste pickup requests and collector route handling.
This version can run on GitHub Pages with Supabase Free, or locally with the included Node backend.

For deployment steps, see `DEPLOY.md`.

## Better landmark search

For stronger landmark/address search during customer testing, create a free Geoapify account and paste the API key in:

```text
js/geo-config.js
```

If no Geoapify key is set, the app falls back to OpenStreetMap/Nominatim search.

## Run locally

Double-click `start-server.bat`, then open:

```text
http://127.0.0.1:8094
```

You can also run the included Node server:

```text
node server.mjs
```

If Node is not installed, `start-server.bat` falls back to Python at `http://localhost:8080`.
The Python fallback serves the static prototype only. For shared online data, configure Supabase in `js/supabase-config.js`.

## Current workflow

1. Resident requests pickup.
2. Collector accepts or declines.
3. Collector marks en route, arrived, then sets the price.
4. Resident submits a MoMo transaction reference.
5. Collector confirms the payment was received.
6. Admin/operator can monitor requests, network users, and platform fees.
