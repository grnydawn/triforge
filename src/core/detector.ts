import { ProjectStateKind } from './types';

export interface FolderProbe {
  hasManifest: boolean;
  legacyLooksLikeProject: boolean;
}

/** Presence-based classification. 'invalid' is decided later by the loader, not here. */
export function classify(probe: FolderProbe): Exclude<ProjectStateKind, 'invalid'> {
  if (probe.hasManifest) return 'ready';
  if (probe.legacyLooksLikeProject) return 'needsImport';
  return 'none';
}

/**
 * Choose which workspace folder Triforge binds to:
 * first with a manifest, else first that looks like a legacy project,
 * else the first folder (so "Create Project Here" has a target), else null.
 */
export function resolveTarget(probes: FolderProbe[]): number | null {
  if (probes.length === 0) return null;
  const manifest = probes.findIndex((p) => p.hasManifest);
  if (manifest >= 0) return manifest;
  const legacy = probes.findIndex((p) => p.legacyLooksLikeProject);
  if (legacy >= 0) return legacy;
  return 0;
}
