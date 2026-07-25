import type * as THREE from 'three';
import type { ViewName } from '../stage';

export interface PreviewVariant {
  id: string;
  label: string;
}

/**
 * One inspectable thing. Adding a subject means adding a file here and
 * registering it in `index.ts` — never extending a switch.
 */
export interface PreviewSubject {
  id: string;
  /** Shown in the harness index when no subject is requested. */
  description: string;
  defaultView: ViewName;
  defaultZoom?: number;
  /** Whether cells get a ground plane for shadows by default. */
  ground?: boolean;
  listVariants(): PreviewVariant[];
  /** Build a fresh, disposable object for one variant. */
  build(variantId: string): THREE.Object3D;
}
