import type { ResultUpdate } from './model';

/**
 * App Group probe analysis (pure). Answers free-ios-install.md §9 unknown #3:
 * does the re-signing tool (SideStore/AltStore) keep the App Group we built
 * with, or rename it to `<group>.<TEAMID>`? expo-widgets reads the group from
 * a build-time Info.plist key, so a rename leaves the Live Activity unable to
 * share data with the app even though the container itself works.
 *
 * Evidence sources, strongest first:
 * - the installed signing profile (embedded.mobileprovision). Re-signing tools
 *   write the profile they signed with, so its application-groups are what
 *   the app is actually entitled to.
 * - containerURL(forSecurityApplicationGroupIdentifier:) per candidate group,
 *   plus a native file write/read in each container.
 * - expo-file-system's Paths.appleSharedContainers. Caution: its group list is
 *   baked in at `pod install` by expo-modules-autolinking (build-time
 *   entitlements), then filtered by containerURL. It shows whether the
 *   configured group resolves, but can never show a renamed group.
 * - ALTAppGroups in Info.plist (written by AltStore-family tools), reported raw.
 */

export interface ContainerCheck {
  /** containerURL(...) returned a URL. */
  resolved: boolean;
  path?: string;
  /** A test file was written, read back identically and deleted. */
  writeRead?: boolean;
  error?: string;
}

export interface NativeAppGroupInfo {
  /** embedded.mobileprovision was present and parsed. */
  profileFound: boolean;
  profileGroups: readonly string[] | null;
  profileTeamId: string | null;
  profileExpiresUtc: string | null;
  altAppGroups: readonly string[] | null;
  /** Keyed by group ID: configured group, profile groups and ALTAppGroups. */
  containers: Readonly<Record<string, ContainerCheck>>;
}

export interface AppGroupEvidence {
  configuredGroup: string;
  /** Keys of Paths.appleSharedContainers (build-time list, filtered by containerURL). */
  expoSharedContainers: readonly string[];
  /** expo-file-system write/read in the configured group's container; null if not attempted. */
  jsWriteRead: { ok: boolean; error?: string } | null;
  /** null when the audio-coach native module isn't in this build. */
  native: NativeAppGroupInfo | null;
}

export type AppGroupClass =
  | { kind: 'match' }
  | { kind: 'renamed'; signedGroup: string; suffix: string }
  | { kind: 'missing'; signedGroups: readonly string[] }
  | { kind: 'unknown' };

/** Compares the configured group with the groups the app was actually signed with. */
export function classifyAppGroup(configured: string, signedGroups: readonly string[] | null): AppGroupClass {
  if (signedGroups === null) return { kind: 'unknown' };
  if (signedGroups.includes(configured)) return { kind: 'match' };
  const renamed = signedGroups.find((g) => g.startsWith(`${configured}.`));
  if (renamed !== undefined) {
    return { kind: 'renamed', signedGroup: renamed, suffix: renamed.slice(configured.length + 1) };
  }
  return { kind: 'missing', signedGroups };
}

/** Suffix the signing tool appended to the bundle ID, or null if unchanged/unrelated. */
export function bundleIdSuffix(installed: string, configured: string): string | null {
  return installed.startsWith(`${configured}.`) && installed.length > configured.length + 1
    ? installed.slice(configured.length + 1)
    : null;
}

function list(values: readonly string[] | null): string {
  if (values === null) return 'unknown';
  return values.length === 0 ? 'none' : values.join(', ');
}

function describeContainer(group: string, c: ContainerCheck | undefined): string {
  if (c === undefined) return `${group}: not checked`;
  if (!c.resolved) return `${group}: no container (not entitled to this group)`;
  const wr = c.writeRead === true ? 'write/read OK' : `write/read FAILED${c.error === undefined ? '' : ` (${c.error})`}`;
  return `${group}: container ${c.path ?? '?'}, ${wr}`;
}

export function analyseAppGroup(e: AppGroupEvidence): ResultUpdate {
  const n = e.native;
  const signedGroups = n?.profileFound === true ? n.profileGroups ?? [] : null;
  const cls = classifyAppGroup(e.configuredGroup, signedGroups);

  const details: string[] = [
    `Configured group (expo-widgets uses this): ${e.configuredGroup}`,
    n === null
      ? 'Signing profile: not read (audio-coach native module not in this build)'
      : n.profileFound
        ? `Signed groups (installed profile): ${list(n.profileGroups)}`
        : 'Signing profile: no embedded.mobileprovision found',
  ];
  if (n !== null && n.profileFound) {
    details.push(`Profile team ID: ${n.profileTeamId ?? 'unknown'}`);
    if (n.profileExpiresUtc !== null) details.push(`Profile expires: ${n.profileExpiresUtc}`);
  }
  if (n !== null) {
    details.push(`ALTAppGroups in Info.plist: ${list(n.altAppGroups)}`);
    for (const [group, c] of Object.entries(n.containers)) details.push(describeContainer(group, c));
  }
  details.push(
    `expo-file-system shared containers (build-time list): ${e.expoSharedContainers.length === 0 ? 'none resolved' : e.expoSharedContainers.join(', ')}`,
  );
  details.push(
    e.jsWriteRead === null
      ? 'expo-file-system write/read: not attempted (configured group has no container)'
      : `expo-file-system write/read: ${e.jsWriteRead.ok ? 'OK' : `FAILED${e.jsWriteRead.error === undefined ? '' : ` (${e.jsWriteRead.error})`}`}`,
  );

  const configuredContainer = n?.containers[e.configuredGroup];
  const configuredWritable = e.jsWriteRead?.ok === true || configuredContainer?.writeRead === true;

  switch (cls.kind) {
    case 'match':
      return configuredWritable
        ? { status: 'pass', summary: `Signed with the configured App Group; container writable`, details }
        : { status: 'fail', summary: 'Signed with the configured App Group, but its container could not be written', details };
    case 'renamed': {
      const renamedWritable = n?.containers[cls.signedGroup]?.writeRead === true;
      return {
        status: 'fail',
        summary:
          `Signing tool renamed the App Group to ${cls.signedGroup} (suffix .${cls.suffix}). ` +
          `expo-widgets still looks for ${e.configuredGroup}, so the Live Activity can't share data`,
        details: [...details, `Renamed group's container ${renamedWritable ? 'is' : 'is NOT'} writable`, 'See ADR 0007 "Known risks"'],
      };
    }
    case 'missing':
      return {
        status: 'fail',
        summary: `The installed app was signed without the configured App Group (signed: ${list(cls.signedGroups)})`,
        details,
      };
    case 'unknown':
      // No profile: judge by container access only, and say so.
      return configuredWritable
        ? {
            status: 'pass',
            summary: 'Configured App Group container resolves and is writable (signing profile not readable)',
            details: [...details, 'Rename could not be checked without the signing profile'],
          }
        : {
            status: 'fail',
            summary: 'Configured App Group has no usable container, and the signing profile could not be read',
            details,
          };
  }
}

function stringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x): x is string => typeof x === 'string') ? v : null;
}

function optionalString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Validates the native module's reply; anything malformed becomes "unknown". */
export function parseNativeAppGroupInfo(raw: unknown): NativeAppGroupInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const containers: Record<string, ContainerCheck> = {};
  if (typeof r.containers === 'object' && r.containers !== null) {
    for (const [group, c] of Object.entries(r.containers as Record<string, unknown>)) {
      if (typeof c !== 'object' || c === null) continue;
      const cc = c as Record<string, unknown>;
      if (typeof cc.resolved !== 'boolean') continue;
      const check: ContainerCheck = { resolved: cc.resolved };
      if (typeof cc.path === 'string') check.path = cc.path;
      if (typeof cc.writeRead === 'boolean') check.writeRead = cc.writeRead;
      if (typeof cc.error === 'string') check.error = cc.error;
      containers[group] = check;
    }
  }
  return {
    profileFound: r.profileFound === true,
    profileGroups: stringArray(r.profileGroups),
    profileTeamId: optionalString(r.profileTeamId),
    profileExpiresUtc: optionalString(r.profileExpiresUtc),
    altAppGroups: stringArray(r.altAppGroups),
    containers,
  };
}
