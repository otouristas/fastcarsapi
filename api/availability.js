import {
  calculateAvailableQuantity,
  diffDaysInclusive,
  extractDailyRate,
  extractVehicleRecords,
  fetchCatalogData,
  fetchSearchResults,
  formatKosmikDate,
  getTotalFleetUnits,
  getVehicleDisplayName,
} from "../lib/kosmikbooker.js";
import { mapVehicleToOtaCode } from "../lib/vehicle-mapping.js";
import {
  buildErrorResponse,
  buildSuccessResponse,
  sendJson,
} from "../lib/response.js";

const SUPPLIER_NAME =
  process.env.SUPPLIER_NAME ?? "Fast Motor Rental Naxos";
const LOCATION_CODE = process.env.LOCATION_CODE ?? "JNX";
const API_KEY = process.env.DISCOVER_CARS_API_KEY ?? "";

/**
 * Vercel Serverless Function
 * GET /api/availability
 *
 * Query params (optional but recommended for live rates):
 * - pickupDate   YYYY-MM-DD or YYYYMMDD
 * - dropoffDate  YYYY-MM-DD or YYYYMMDD
 * - pickupTime   HH:mm (default 10:00)
 * - dropoffTime  HH:mm (default 10:00)
 * - includeUnavailable  true|false (default false)
 */
export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(
      res,
      405,
      buildErrorResponse({
        statusCode: 405,
        code: "METHOD_NOT_ALLOWED",
        message: "Only GET is supported",
      }),
    );
    return;
  }

  if (API_KEY) {
    const providedKey =
      req.headers["x-api-key"] ??
      req.headers.authorization?.replace(/^Bearer\s+/i, "");

    if (providedKey !== API_KEY) {
      sendJson(
        res,
        401,
        buildErrorResponse({
          statusCode: 401,
          code: "UNAUTHORIZED",
          message: "Invalid or missing API key",
        }),
      );
      return;
    }
  }

  try {
    const query = req.query ?? {};
    const pickupDate = query.pickupDate ?? query.from ?? null;
    const dropoffDate = query.dropoffDate ?? query.to ?? null;
    const pickupTime = query.pickupTime ?? query.from_time ?? "10:00";
    const dropoffTime = query.dropoffTime ?? query.to_time ?? "10:00";
    const includeUnavailable =
      String(query.includeUnavailable ?? "false").toLowerCase() === "true";

    // 1) Always pull the widget catalog payload first.
    const catalog = await fetchCatalogData();
    const catalogVehicles = extractVehicleRecords(catalog);

    if (catalogVehicles.length === 0) {
      sendJson(
        res,
        502,
        buildErrorResponse({
          statusCode: 502,
          code: "UNEXPECTED_UPSTREAM_SHAPE",
          message:
            "KosmikBooker payload did not contain vehicles under types/items/categories/vehicles",
          details: { topLevelKeys: Object.keys(catalog ?? {}) },
        }),
      );
      return;
    }

    const currency = catalog.listing?.currency ?? "EUR";
    const supplierName = catalog.listing?.name ?? SUPPLIER_NAME;

    let source = "kosmikbooker:/data";
    let workingVehicles = catalogVehicles;
    let rentalDays = 1;

    // 2) When dates are supplied, enrich with /search for true availability + pricing.
    let searchPayload = null;
    if (pickupDate && dropoffDate) {
      rentalDays = diffDaysInclusive(pickupDate, dropoffDate);

      searchPayload = await fetchSearchResults({
        key: catalog.key,
        vkey: catalog.vkey,
        pickupDate,
        dropoffDate,
        pickupTime,
        dropoffTime,
      });

      if (searchPayload?.query?.nights > 0) {
        rentalDays = Number(searchPayload.query.nights);
      }

      const searchVehicles = extractVehicleRecords(searchPayload);
      if (searchVehicles.length > 0) {
        workingVehicles = mergeCatalogAndSearch(catalogVehicles, searchVehicles);
        source = "kosmikbooker:/data+search";
      }
    }

    const fleet = workingVehicles
      .filter(isPublishedVehicle)
      .map((vehicle) => transformVehicle(vehicle, rentalDays))
      .filter((vehicle) => includeUnavailable || vehicle.quantityAvailable > 0)
      .sort((a, b) => a.vehicleName.localeCompare(b.vehicleName));

    sendJson(
      res,
      200,
      buildSuccessResponse({
        supplierName,
        locationCode: LOCATION_CODE,
        currency,
        pickupDate: pickupDate ? normalizeDateForResponse(pickupDate) : null,
        dropoffDate: dropoffDate ? normalizeDateForResponse(dropoffDate) : null,
        pickupTime,
        dropoffTime,
        vehicles: fleet,
        source,
      }),
    );
  } catch (error) {
    const statusCode = error.statusCode ?? 500;
    sendJson(
      res,
      statusCode,
      buildErrorResponse({
        statusCode,
        code: error.code ?? "INTERNAL_ERROR",
        message:
          error.message ??
          "Unexpected error while building availability response",
      }),
    );
  }
}

function isPublishedVehicle(vehicle) {
  if (vehicle.deleted === 1 || vehicle.type_deleted === "car_1") return false;
  if (vehicle.published === 0 || vehicle.type_published === "car_0") {
    return false;
  }
  return true;
}

/** Prefer search-enriched vehicle objects while keeping catalog metadata as fallback. */
function mergeCatalogAndSearch(catalogVehicles, searchVehicles) {
  const catalogById = new Map(
    catalogVehicles.filter((v) => v.id).map((v) => [v.id, v]),
  );

  return searchVehicles.map((searchVehicle) => {
    const catalogVehicle = catalogById.get(searchVehicle.id) ?? {};
    return {
      ...catalogVehicle,
      ...searchVehicle,
    };
  });
}

function transformVehicle(vehicle, rentalDays) {
  const vehicleName = getVehicleDisplayName(vehicle);
  const { code, mappingStrategy } = mapVehicleToOtaCode(vehicle);
  const totalFleetUnits = getTotalFleetUnits(vehicle);
  const quantityAvailable = calculateAvailableQuantity(vehicle, rentalDays);
  const dailyRate = extractDailyRate(vehicle, rentalDays);

  return {
    supplierVehicleId: vehicle.id ?? null,
    vehicleClassCode: code,
    vehicleName,
    category: vehicle.category ?? null,
    acrissGroup: vehicle.group_class ?? null,
    transmission: vehicle.transmission ?? null,
    fuel: vehicle.fuel ?? null,
    seats: vehicle.seats ?? null,
    totalFleetUnits,
    quantityAvailable,
    dailyRate,
    totalRate:
      dailyRate == null ? null : round2(dailyRate * Math.max(1, rentalDays)),
    currency: "EUR",
    unavailable: quantityAvailable <= 0,
    mappingStrategy,
  };
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeDateForResponse(input) {
  if (/^\d{8}$/.test(input)) {
    return `${input.slice(0, 4)}-${input.slice(4, 6)}-${input.slice(6, 8)}`;
  }
  return formatKosmikDate(input).replace(
    /^(\d{4})(\d{2})(\d{2})$/,
    "$1-$2-$3",
  );
}
