/** KosmikBooker / CosmicBooker public endpoints used by the booking widget. */
export const COSMICBOOKER_DATA_URL =
  process.env.COSMICBOOKER_DATA_URL ??
  "https://fastmotorentalnaxos.cosmicbooker.com/data";

export const COSMICBOOKER_BASE_URL =
  process.env.COSMICBOOKER_BASE_URL ??
  "https://fastmotorentalnaxos.cosmicbooker.com";

const DEFAULT_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 12_000);

/**
 * Fetch JSON from KosmikBooker with timeout and basic validation.
 */
export async function fetchKosmikJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "FastMotorRental-DiscoverCars-Bridge/1.0",
        ...(options.headers ?? {}),
      },
    });

    if (!response.ok) {
      const error = new Error(
        `KosmikBooker upstream HTTP ${response.status} for ${url}`,
      );
      error.statusCode = response.status >= 500 ? 502 : 502;
      error.code = "UPSTREAM_HTTP_ERROR";
      throw error;
    }

    const payload = await response.json();

    if (payload?.errors?.length) {
      const error = new Error(
        `KosmikBooker reported errors: ${JSON.stringify(payload.errors)}`,
      );
      error.statusCode = 502;
      error.code = "UPSTREAM_BUSINESS_ERROR";
      throw error;
    }

    return payload;
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutError = new Error("KosmikBooker request timed out");
      timeoutError.statusCode = 504;
      timeoutError.code = "UPSTREAM_TIMEOUT";
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Load the static widget payload (fleet catalog, keys, rate plans). */
export async function fetchCatalogData() {
  return fetchKosmikJson(COSMICBOOKER_DATA_URL);
}

/**
 * Load date-specific availability and pricing.
 * The widget uses the same /search endpoint with session keys from /data.
 */
export async function fetchSearchResults({
  key,
  vkey,
  pickupDate,
  dropoffDate,
  pickupTime = "10:00",
  dropoffTime = "10:00",
}) {
  const params = new URLSearchParams({
    from: formatKosmikDate(pickupDate),
    from_time: pickupTime,
    to: formatKosmikDate(dropoffDate),
    to_time: dropoffTime,
    key,
    vkey,
    _nd: String(Date.now()),
  });

  const url = `${COSMICBOOKER_BASE_URL}/search?${params.toString()}`;
  return fetchKosmikJson(url);
}

/** Normalize YYYY-MM-DD or Date into KosmikBooker YYYYMMDD. */
export function formatKosmikDate(input) {
  if (!input) return "";

  if (/^\d{8}$/.test(input)) return input;

  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${input}`);
  }

  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/** KosmikBooker stores vehicles under `types`; keep fallbacks for other shapes. */
export function extractVehicleRecords(payload) {
  if (!payload || typeof payload !== "object") return [];

  const candidates = [
    payload.types,
    payload.vehicles,
    payload.items,
    payload.categories,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }

  return [];
}

/** Build a display name from KosmikBooker vehicle fields. */
export function getVehicleDisplayName(vehicle) {
  const explicit =
    vehicle.internal_name ||
    vehicle.name ||
    vehicle.title ||
    vehicle.short_description;

  if (explicit && String(explicit).trim()) return String(explicit).trim();

  const make = vehicle.make_name ?? vehicle.make ?? "";
  const model = vehicle.model_name ?? vehicle.model ?? "";
  const cubic = vehicle.cubic ? `${vehicle.cubic}cc` : "";

  return [make, model, cubic].filter(Boolean).join(" ").trim() || "Unknown vehicle";
}

/**
 * Count active/blocked units from search `rates.*.booked` hour maps.
 * Falls back to simpler fields when detailed maps are absent.
 *
 * KosmikBooker `/search` nuance: `capacity` is fleet size, not rental-window
 * availability. Use `unavailable`, `min_available`, and `daily_availability`
 * first — otherwise every vehicle looks permanently in stock.
 */
export function calculateAvailableQuantity(vehicle, rentalDays = 1) {
  if (vehicle.unavailable === 1 || vehicle.unavailable === true) {
    return 0;
  }

  if (vehicle.min_available != null && vehicle.min_available !== "") {
    return Math.max(0, Number(vehicle.min_available) || 0);
  }

  if (
    vehicle.daily_availability &&
    typeof vehicle.daily_availability === "object"
  ) {
    const dailyValues = Object.values(vehicle.daily_availability)
      .map(Number)
      .filter((value) => !Number.isNaN(value));

    if (dailyValues.length > 0) {
      return Math.max(0, Math.min(...dailyValues));
    }
  }

  const totalFleet = getTotalFleetUnits(vehicle);
  const blocked = countBlockedUnits(vehicle, rentalDays);
  if (blocked > 0) {
    return Math.max(0, totalFleet - blocked);
  }

  if (vehicle.capacity != null && vehicle.capacity !== "") {
    return Math.max(0, Number(vehicle.capacity) || 0);
  }

  return totalFleet;
}

export function getTotalFleetUnits(vehicle) {
  if (Array.isArray(vehicle.fleet) && vehicle.fleet.length > 0) {
    const activeFleet = vehicle.fleet.filter(
      (unit) => !unit.deleted && unit.damaged !== 1,
    );
    return activeFleet.length;
  }

  if (vehicle.total != null && vehicle.total !== "") {
    return Math.max(0, Number(vehicle.total) || 0);
  }

  return 0;
}

function countBlockedUnits(vehicle, rentalDays) {
  if (!vehicle?.rates || typeof vehicle.rates !== "object") {
    return vehicle.unavailable === 1 ? getTotalFleetUnits(vehicle) : 0;
  }

  let maxBooked = 0;

  for (const rateEntry of Object.values(vehicle.rates)) {
    const bookedMap = rateEntry?.booked;
    if (!bookedMap || typeof bookedMap !== "object") continue;

    const bookedSlots = Object.values(bookedMap).reduce(
      (sum, value) => sum + (Number(value) > 0 ? 1 : 0),
      0,
    );

    maxBooked = Math.max(maxBooked, bookedSlots);
  }

  if (maxBooked > 0) return maxBooked;

  if (vehicle.daily_availability && rentalDays > 0) {
    const dailyValues = Object.values(vehicle.daily_availability).map(Number);
    if (dailyValues.length > 0) {
      const minDaily = Math.min(...dailyValues);
      return Math.max(0, getTotalFleetUnits(vehicle) - minDaily);
    }
  }

  return 0;
}

/**
 * Pick the best daily rate from search-enriched vehicle data.
 * KosmikBooker `/search` returns stay totals in `min_price` and `total_pricing.pax_1`.
 */
export function extractDailyRate(vehicle, rentalDays = 1) {
  const days = Math.max(1, Number(rentalDays) || 1);

  // Explicit daily rate fields (rare in catalog payload, but handle if present).
  const dailyCandidates = [vehicle.daily_rate, vehicle.price_per_day].filter(
    (value) => value !== "" && value != null,
  );

  for (const candidate of dailyCandidates) {
    const parsed = Number(candidate);
    if (!Number.isNaN(parsed) && parsed > 0) return roundMoney(parsed);
  }

  const ratePlans = vehicle.rate_plans ?? vehicle.plans ?? {};
  let bestDaily = null;

  for (const plan of Object.values(ratePlans)) {
    if (!plan || plan.deleted === 1 || plan.published === 0) continue;

    const totalPricing = plan.total_pricing ?? plan.pricing ?? {};
    const totalForStay =
      totalPricing[`pax_${days}`] ??
      totalPricing.pax_1 ??
      plan.total ??
      plan.price;

    const parsedTotal = Number(totalForStay);
    if (Number.isNaN(parsedTotal) || parsedTotal <= 0) continue;

    const daily = parsedTotal / days;
    bestDaily = bestDaily == null ? daily : Math.min(bestDaily, daily);
  }

  if (bestDaily != null) return roundMoney(bestDaily);

  // Fall back to min_price / generic price, treating them as stay totals when dates are used.
  const stayTotals = [vehicle.min_price, vehicle.price, vehicle.base_price].filter(
    (value) => value !== "" && value != null,
  );

  for (const candidate of stayTotals) {
    const parsed = Number(candidate);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return roundMoney(parsed / days);
    }
  }

  return null;
}

export function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

export function diffDaysInclusive(pickupDate, dropoffDate) {
  const start = new Date(`${normalizeIsoDate(pickupDate)}T00:00:00Z`);
  const end = new Date(`${normalizeIsoDate(dropoffDate)}T00:00:00Z`);
  const diffMs = end.getTime() - start.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, days || 1);
}

function normalizeIsoDate(input) {
  if (/^\d{8}$/.test(input)) {
    return `${input.slice(0, 4)}-${input.slice(4, 6)}-${input.slice(6, 8)}`;
  }
  return input;
}
