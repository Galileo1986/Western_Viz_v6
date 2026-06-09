// Data domain — Cascade resolution (PURE). SOP: architecture/cascade.md
// The determinism core. Imports nothing. Single implementation of tier traversal.

// Coarse -> fine. index 0 = coarsest. (cascade.md; building ⊃ floor ⊃ section ⊃ zone(end).)
export const TIERS = ['building', 'floor', 'section', 'zone'];

// Viewing scope mode -> finest tier resolved for UNSELECTED geometry (SOP §"Scope -> start-tier").
// Two-state navigation: campus differentiates buildings (building-tier aggregate); building resolves
// EVERY room at the finest (end-zone) tier, walking coarser on null — which makes the categorical
// (building/room) layers reachable at building scope. Floor/zone are selection, not navigation.
export const SCOPE_START_TIER = { campus: 'building', building: 'zone' };

// Room-native slots bypass the cascade tiers and read a room field directly (the data-domain registry
// for per-room values — categoricals + a couple of numerics). One entry per room-native slot; mirrored
// in tools/verify_cascade_parity.py. Adding a room-native layer = 1 entry here + 1 slot in extract_data.
const ROOM_NATIVE = {
  reconciliation_status: 'reconciliation_status', division: 'division', room_use: 'room_use',
  space_category: 'space_category', college: 'college', healthcare_space: 'healthcare_space',
  room_type: 'room_type', space_standard: 'space_standard', cpec_code: 'cpec_code',
  zone_source: 'zone_source', nominal_seats: 'classroom_capacity', sqft_per_seat: 'sqft_per_seat',
};

// Order of tiers from a given start tier, walking COARSER (for inheritance fallback).
function fromFinest(startTier) {
  const i = TIERS.indexOf(startTier);
  // walk from start tier toward coarser (lower index)
  return TIERS.slice(0, i + 1).reverse(); // e.g. zone -> [zone, floor, section, building]
}

// resolveWithTier(scopePath, slotId, room) -> { value, tier }   (SOP contract, spec §3.3 §6.6)
// tier = the bucket that supplied the value ('zone'|'section'|'floor'|'building'), or null for
// all-null / room-native. Single walk; resolve() delegates to it.
export function resolveWithTier(scopePath, slotId, room) {
  if (!room) return { value: null, tier: null };

  // room-native slots ignore tiers entirely (no cascade tier attributed)
  if (slotId in ROOM_NATIVE) {
    const v = room[ROOM_NATIVE[slotId]];
    return { value: v === undefined ? null : v, tier: null };
  }

  const startTier = (scopePath && scopePath.tier) || 'zone';
  const readings = room.readings || {};
  for (const tier of fromFinest(startTier)) {
    const bucket = readings[tier];
    if (!bucket) continue;
    const v = bucket[slotId];
    if (v !== null && v !== undefined) return { value: v, tier };
  }
  return { value: null, tier: null }; // all tiers null -> Interpretation classifies as missing
}

// resolve(scopePath, slotId, room) -> value | null   (value-only convenience)
export function resolve(scopePath, slotId, room) {
  return resolveWithTier(scopePath, slotId, room).value;
}

// Convenience for State.derive: map a scope mode to a scopePath. When the active layer paints rooms at
// campus (campus_render === 'rooms'), campus resolves at the FINE (building-scope) tier so each room shows
// its own value; otherwise the per-building aggregate. (rendering.md "Campus room-paint", cascade.md.)
export function scopePathFor(mode, campusRender) {
  if (mode === 'campus' && campusRender === 'rooms') return { tier: SCOPE_START_TIER.building };
  return { tier: SCOPE_START_TIER[mode] || 'building' };
}

// Selection always resolves at the finest tier, walking coarser.
export const SELECTION_SCOPE = { tier: 'zone' };
