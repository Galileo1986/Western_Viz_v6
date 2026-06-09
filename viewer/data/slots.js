// Data domain — slot/registry access, indexing, reading resolution, dual-source/drift, scope-mode.
// SOP: architecture/data.md. PURE (no IO, no DOM, no colors). Imports cascade (same domain) only.

import { resolve, SELECTION_SCOPE } from './cascade.js';

// ---- key + indexing --------------------------------------------------------
// styleMap / geometry join key (claude.md §2.1): "<Building_Code>::<INV_Room_Number>"
export function roomKey(buildingCode, roomId) {
  return `${buildingCode}::${roomId}`;
}

// Build { key -> roomRecord } for a loaded building (O(1) join with geometry + selection).
export function indexRooms(building) {
  const byKey = new Map();
  for (const room of building.rooms || []) {
    byKey.set(roomKey(building.building_code, room.room_id), room);
  }
  return byKey;
}

// ---- scope mode (spec §3.2) ------------------------------------------------
// Single place the mode is decided. Two-state navigation: a focused building ⇒ 'building',
// otherwise 'campus'. Floor/zone are selection, not scope (cascade.md, state.md).
export function deriveMode(raw) {
  const s = raw.scope || {};
  return s.buildingCode ? 'building' : 'campus';
}

// ---- dual-source / drift (spec §3.5, §6.4) ---------------------------------
// The current extract carries one reconciled value + provenance flags (zone_source,
// reconciliation_status) — NOT parallel ZR/AVG numbers. So divergence is surfaced as a
// visible flag; we never average (there is nothing to average). When the extractor later
// emits alt-source values, populate `alt` here and the view-model/UI already carry it.
function driftOf(room) {
  const status = room.reconciliation_status;
  const diverges = !!status && status !== 'FULL_MATCH';
  return { diverges, source: diverges ? 'drift' : 'reconciled', status, zoneSource: room.zone_source || null };
}

// ---- reading resolution (pure) ---------------------------------------------
// One reading per slot, cascade-resolved at the finest tier. `formatted` is added by
// State.derive via Interpretation (formatting is not a Data concern). `slot` ref is carried
// so derive can format generically (spec §8: add slot -> 0 panel-structure change).
export function resolveSelectionReadings(room, slots) {
  if (!room) return [];
  const drift = driftOf(room);
  return slots.map((slot) => {
    const value = resolve(SELECTION_SCOPE, slot.slot_id, room);
    return {
      slot,
      slotId: slot.slot_id,
      displayName: slot.display_name,
      value,
      source: drift.source,
      diverges: drift.diverges,
      // alt: undefined  // reserved for future alt-source numeric value
    };
  });
}

// Drift metadata for a selected room (UI shows the flag prominently).
export function selectionDrift(room) {
  return room ? driftOf(room) : null;
}
