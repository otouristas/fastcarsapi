export function buildSuccessResponse({
  supplierName,
  locationCode,
  currency,
  pickupDate,
  dropoffDate,
  pickupTime,
  dropoffTime,
  vehicles,
  source,
}) {
  return {
    status: "success",
    supplier: supplierName,
    locationCode,
    currency,
    timestamp: new Date().toISOString(),
    rentalPeriod: {
      pickupDate,
      pickupTime,
      dropoffDate,
      dropoffTime,
    },
    fleet: vehicles,
    meta: {
      itemCount: vehicles.length,
      source,
      schema: "discover-cars-availability-v1",
    },
  };
}

export function buildErrorResponse({
  statusCode,
  code,
  message,
  details = null,
}) {
  return {
    status: "error",
    error: {
      code,
      message,
      details,
    },
    timestamp: new Date().toISOString(),
    fleet: [],
  };
}

export function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}
