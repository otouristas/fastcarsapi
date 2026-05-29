# Fast Motor Rental Naxos → Discover Cars Bridge

Production-ready Vercel middleware that reads live KosmikBooker (CosmicBooker) inventory and exposes a clean B2B availability/rates JSON endpoint for Discover Cars.

## How it works

1. **GET `/data`** — loads fleet catalog, rate plans, and session keys (`key`, `vkey`).
2. **Optional GET `/search`** — when `pickupDate` + `dropoffDate` are provided, enriches each vehicle with live availability, booked units, and dynamic pricing (same flow as the public booking widget).
3. **Vehicle mapping** — maps KosmikBooker vehicle names/categories to Discover Cars supplier class codes via `lib/vehicle-mapping.js`.
4. **Availability math** — `quantityAvailable = totalFleetUnits - blockedUnits`, using search `capacity`, `daily_availability`, or `rates.*.booked` when present.

## Deploy to Vercel

```bash
cd fmr-discover-cars-bridge
npm install   # no runtime deps; optional for local tooling
npx vercel
```

For production:

```bash
npx vercel --prod
```

### Environment variables (Vercel dashboard → Project → Settings → Environment Variables)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DISCOVER_CARS_API_KEY` | Recommended | — | Protects your endpoint (`X-Api-Key` header) |
| `SUPPLIER_NAME` | No | Fast Motor Rental Naxos | Response supplier label |
| `LOCATION_CODE` | No | `JNX` | Naxos airport / location code for OTAs |
| `COSMICBOOKER_DATA_URL` | No | widget `/data` URL | Override source catalog URL |
| `COSMICBOOKER_BASE_URL` | No | widget base URL | Override search base URL |
| `UPSTREAM_TIMEOUT_MS` | No | `12000` | Upstream fetch timeout |

## API usage

**Endpoint:** `GET /api/availability`

**Recommended (live rates + true availability):**

```bash
curl -s \
  -H "X-Api-Key: YOUR_SECRET" \
  "https://YOUR-PROJECT.vercel.app/api/availability?pickupDate=2026-06-01&dropoffDate=2026-06-05&pickupTime=10:00&dropoffTime=10:00"
```

**Catalog-only snapshot (no dates):**

```bash
curl -s "https://YOUR-PROJECT.vercel.app/api/availability"
```

### Example success response

```json
{
  "status": "success",
  "supplier": "Fast Motor Rental Naxos",
  "locationCode": "JNX",
  "currency": "EUR",
  "timestamp": "2026-05-29T12:00:00.000Z",
  "rentalPeriod": {
    "pickupDate": "2026-06-01",
    "pickupTime": "10:00",
    "dropoffDate": "2026-06-05",
    "dropoffTime": "10:00"
  },
  "fleet": [
    {
      "supplierVehicleId": "f18350c8-63a3-43ca-a213-16046bf86156",
      "vehicleClassCode": "ECMR",
      "vehicleName": "Fiat Panda",
      "category": "compact",
      "quantityAvailable": 1,
      "dailyRate": 30,
      "totalRate": 120,
      "currency": "EUR",
      "unavailable": false,
      "mappingStrategy": "exact"
    }
  ],
  "meta": {
    "itemCount": 1,
    "source": "kosmikbooker:/data+search",
    "schema": "discover-cars-availability-v1"
  }
}
```

## Customizing vehicle mappings

Edit `lib/vehicle-mapping.js`:

- **`exact`** — full normalized vehicle name → OTA code
- **`patterns`** — regex fallbacks (scooters, quads, SUVs)
- **`categories`** — generic fallback by KosmikBooker category

Placeholder examples already included:

- `Sym Symphony 125cc` → `TW_A_125`
- `Piaggio Beverly 300cc` → `TW_B_300`
- Quad / scooter / car category defaults

## Local demo (showcase UI)

Run the API and visual demo together:

```bash
npm run demo
```

Then open:

- **Showcase UI:** http://localhost:3001
- **Raw JSON API:** http://localhost:3001/api/availability?pickupDate=2026-06-01&dropoffDate=2026-06-05

The demo page lets you pick pickup/drop-off dates and displays live availability, daily rates, and OTA vehicle class codes in a presentation-ready layout.

## Notes for Discover Cars onboarding

- Share the production URL and your `X-Api-Key` with Discover Cars integration team.
- Confirm their expected field names; adjust `lib/response.js` if they require a specific schema.
- Always pass rental dates in production so rates reflect real-time availability rather than catalog-only totals.
