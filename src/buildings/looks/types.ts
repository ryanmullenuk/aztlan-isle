import type * as THREE from 'three';
import type { GeoBuilder } from '../../render/GeoBuilder';

/**
 * What one upgrade adds to a building's model: drawn into the model's own builder (model-local,
 * door facing +z, footprint w × d centred on the origin, ground at y = 0). Push any new flames
 * (fire bowls, torches, lanterns) onto `torches`.
 */
export type Look = (b: GeoBuilder, w: number, d: number, torches: THREE.Vector3[]) => void;

/** Per building, one look for each of its upgrades in order (index 0 = the first upgrade). */
export type Looks = Partial<Record<import('../../config').BuildingKey, Look[]>>;
