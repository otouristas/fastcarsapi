/**
 * Map KosmikBooker vehicle names/categories to Discover Cars supplier class codes.
 *
 * HOW TO EXTEND:
 * 1. Add an exact key under `exact` using the normalized display name.
 * 2. Add partial patterns under `patterns` (first match wins).
 * 3. Add category fallbacks under `categories` for generic mapping.
 */
export const VEHICLE_CLASS_MAP = {
  exact: {
    "sym symphony 125": "TW_A_125",
    "sym symphony 125cc": "TW_A_125",
    "piaggio beverly 300": "TW_B_300",
    "piaggio beverly 300cc": "TW_B_300",
    "fiat panda": "ECMR",
    "renault clio": "EDMR",
    "dacia sandero": "CFMR",
    "renault captur": "IFMR",
    "hyundai i 10": "MCMR",
    "hyundai i10": "MCMR",
    "ford fiesta": "EDMR",
    "toyota aygo": "MCMR",
    "peugeot 108": "MCMR",
    "nissan micra": "EDMR",
    "hyundai kona": "IFAR",
    "peugeot 208": "EDMR",
  },

  patterns: [
    { match: /sym\s*symphony\s*125/i, code: "TW_A_125" },
    { match: /piaggio\s*beverly\s*300/i, code: "TW_B_300" },
    { match: /125\s*cc|125cc/i, code: "TW_A_125" },
    { match: /300\s*cc|300cc/i, code: "TW_B_300" },
    { match: /quad|atv|buggy/i, code: "QUAD_GENERIC" },
    { match: /scooter|moped|motorbike|motorcycle/i, code: "TW_GENERIC" },
    { match: /suv|crossover|kona|captur/i, code: "IFAR" },
    { match: /mini|aygo|108|i\s*10|i10/i, code: "MCMR" },
    { match: /automatic/i, code: "CAR_AUTO" },
  ],

  categories: {
    small_mini: "MCMR",
    compact: "EDMR",
    economy: "ECMR",
    suv: "IFAR",
    intermediate: "IDAR",
    scooter: "TW_GENERIC",
    quad: "QUAD_GENERIC",
    atv: "QUAD_GENERIC",
    car: "ECMR",
    default: "CAR_GENERIC",
  },
};

export function normalizeVehicleName(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s-]/g, "");
}

/**
 * Resolve a Discover Cars / ACRISS-style supplier vehicle class code.
 */
export function mapVehicleToOtaCode(vehicle) {
  const displayName = [
    vehicle.internal_name,
    vehicle.name,
    vehicle.make_name,
    vehicle.model_name,
    vehicle.model,
  ]
    .filter(Boolean)
    .join(" ");

  const normalized = normalizeVehicleName(displayName);
  const makeModel = normalizeVehicleName(
    [vehicle.make_name ?? vehicle.make, vehicle.model_name ?? vehicle.model]
      .filter(Boolean)
      .join(" "),
  );

  if (VEHICLE_CLASS_MAP.exact[normalized]) {
    return {
      code: VEHICLE_CLASS_MAP.exact[normalized],
      mappingStrategy: "exact",
    };
  }

  if (makeModel && VEHICLE_CLASS_MAP.exact[makeModel]) {
    return {
      code: VEHICLE_CLASS_MAP.exact[makeModel],
      mappingStrategy: "exact-make-model",
    };
  }

  for (const pattern of VEHICLE_CLASS_MAP.patterns) {
    if (pattern.match.test(displayName) || pattern.match.test(normalized)) {
      return { code: pattern.code, mappingStrategy: "pattern" };
    }
  }

  const category = String(vehicle.category ?? vehicle.group_class ?? "")
    .trim()
    .toLowerCase();

  const categoryCode =
    VEHICLE_CLASS_MAP.categories[category] ??
    VEHICLE_CLASS_MAP.categories.default;

  return {
    code: categoryCode,
    mappingStrategy: "category",
  };
}
