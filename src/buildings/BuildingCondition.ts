/** Optional fields keep lightweight callers and older saves compatible. */
export interface BuildingCondition {
  complete: boolean;
  integrity?: number;
  fire?: number;
  ruined?: boolean;
  repairing?: boolean;
}
export function buildingSafe(b: BuildingCondition | null | undefined): boolean {
  return !!b?.complete && !b.ruined && !(b.fire! > 0);
}
export function buildingOperational(b: BuildingCondition | null | undefined): boolean {
  return buildingSafe(b) && (b!.integrity ?? 1) >= 1 && !b!.repairing;
}
