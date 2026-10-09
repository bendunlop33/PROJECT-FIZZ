import type { ResultUpdate } from './model';

/**
 * App Group probe analysis (pure). Answers free-ios-install.md §9 unknown #3
 * and checks the ADR 0007 fix.
 *
 * SideStore/AltStore sign the app AND the Live Activity extension with
 * `<group>.<TEAMID>` instead of the group we built with, and write the renamed
 * group into each bundle's ALTAppGroups. Stock expo-widgets reads only the
 * build-time group, so the Live Activity can't share data. Our pinned patch
 * (patches/expo-widgets+57.0.23.patch) resolves the group at runtime in both
 * processes and records its choice in the chosen group's shared defaults.
 *
 * PASS needs both sides:
 * - app: signed with the configured group (or a rename the app resolved at
 *   runtime), and a test file written and read back in that container;
 * - extension: present in the installed app, its own profile carries the same
 *   group, and its own resolution record (written by the extension process
 *   into the shared container, read back here) names the same group. The
 *   record only exists once the extension has run, i.e. after a Live Activity
 *   has been shown in this build.
 *
 * Evidence sources:
 * - the installed signing profiles (embedded.mobileprovision of the app and of
 *   PlugIns/ExpoWidgetsTarget.appex): what each bundle is actually entitled to;
 * - containerURL(forSecurityApplicationGroupIdentifier:) per candidate group,
 *   plus a native file write/read in each container;
 * - resolution records written by the patched expo-widgets;
 * - expo-widgets' own `widgetsDirectory` (non-empty only if its app side found
 *   a container);
 * - expo-file-system's Paths.appleSharedContainers. Caution: its group list is
 *   baked in at `pod install` (build-time entitlements), so it can never show a
 *   renamed group;
 * - ALTAppGroups in each Info.plist, reported raw.
 */

export interface ContainerCheck {
  /** containerURL(...) returned a URL. */
  resolved: boolean;
  path?: string;
  /** A test file was written, read back identically and deleted. */
  writeRead?: boolean;
  error?: string;
}

export interface SigningProfile {
  /** embedded.mobileprovision was present and parsed. */
  profileFound: boolean;
  profileGroups: readonly string[] | null;
  profileTeamId: string | null;
  profileExpiresUtc: string | null;
}

export interface ExtensionInfo extends SigningProfile {
  /** PlugIns/ExpoWidgetsTarget.appex exists in the installed app. */
  present: boolean;
  bundleId: string | null;
  /** ExpoWidgetsAppGroupIdentifier in the extension's Info.plist (build time). */
  configuredGroup: string | null;
  altAppGroups: readonly string[] | null;
}

/** Which group a process chose at runtime (written by the expo-widgets patch). */
export interface ResolutionRecord {
  role: 'app' | 'extension';
  group: string;
  /** "altAppGroups" | "parentAltAppGroups" | "configured" */
  source: string;
  bundleId: string;
  buildNumber: string;
  atUtc: string;
  /** The group whose shared defaults held the record. */
  foundIn: string;
}

export interface NativeAppGroupInfo extends SigningProfile {
  altAppGroups: readonly string[] | null;
  /** NSSupportsLiveActivities in the app's Info.plist; null if not reported. */
  supportsLiveActivities: boolean | null;
  /** Settings > GymSmarter > Live Activities; null if not reported. */
  activitiesEnabled: boolean | null;
  /** null if this build's native module doesn't report it. */
  extension: ExtensionInfo | null;
  /** Keyed by group ID: configured group, profile groups and ALTAppGroups of both bundles. */
  containers: Readonly<Record<string, ContainerCheck>>;
  records: readonly ResolutionRecord[];
}

export interface AppGroupEvidence {
  configuredGroup: string;
  /** This build's CFBundleVersion. Records written by other builds don't count. */
  buildNumber: string;
  /** Keys of Paths.appleSharedContainers (build-time list, filtered by containerURL). */
  expoSharedContainers: readonly string[];
  /** expo-file-system write/read in the configured group's container; null if not attempted. */
  jsWriteRead: { ok: boolean; error?: string } | null;
  /** expo-widgets' widgetsDirectory constant; null/empty means its app side found no container. */
  expoWidgetsDirectory: string | null;
  /** null when the audio-coach native module isn't in this build. */
  native: NativeAppGroupInfo | null;
}

export type AppGroupClass =
  | { kind: 'match' }
  | { kind: 'renamed'; signedGroup: string; suffix: string }
  | { kind: 'missing'; signedGroups: readonly string[] }
  | { kind: 'unknown' };

/** Compares the configured group with the groups a bundle was actually signed with. */
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

function yesNo(v: boolean | null): string {
  return v === null ? 'unknown' : v ? 'yes' : 'NO';
}

function describeContainer(group: string, c: ContainerCheck | undefined): string {
  if (c === undefined) return `${group}: not checked`;
  if (!c.resolved) return `${group}: no container (not entitled to this group)`;
  const wr = c.writeRead === true ? 'write/read OK' : `write/read FAILED${c.error === undefined ? '' : ` (${c.error})`}`;
  return `${group}: container ${c.path ?? '?'}, ${wr}`;
}

function describeProfile(who: string, p: SigningProfile): string[] {
  if (!p.profileFound) return [`${who} signing profile: no embedded.mobileprovision found`];
  const lines = [`${who} signed groups (installed profile): ${list(p.profileGroups)}`, `${who} profile team ID: ${p.profileTeamId ?? 'unknown'}`];
  if (p.profileExpiresUtc !== null) lines.push(`${who} profile expires: ${p.profileExpiresUtc}`);
  return lines;
}

function describeRecord(r: ResolutionRecord, currentBuild: string): string {
  const build = r.buildNumber === currentBuild ? `build ${r.buildNumber}` : `OLDER build ${r.buildNumber || '?'} (ignored)`;
  return `${r.role === 'app' ? 'App' : 'Extension'} resolved ${r.group} from ${r.source} at ${r.atUtc} (${build}, ${r.bundleId})`;
}

/** Newest record for a role written by this build, if any. */
export function currentRecord(
  records: readonly ResolutionRecord[],
  role: ResolutionRecord['role'],
  buildNumber: string,
): ResolutionRecord | null {
  let best: ResolutionRecord | null = null;
  for (const r of records) {
    if (r.role !== role || r.buildNumber !== buildNumber) continue;
    if (best === null || r.atUtc > best.atUtc) best = r;
  }
  return best;
}

type SideVerdict = { ok: true; line: string } | { ok: false; pending: boolean; line: string };

function judgeExtension(n: NativeAppGroupInfo, expectedGroup: string, buildNumber: string): SideVerdict {
  const ext = n.extension;
  if (ext === null) {
    return { ok: false, pending: false, line: 'Extension: not checked (this build does not report it)' };
  }
  if (!ext.present) {
    return {
      ok: false,
      pending: false,
      line: 'Extension: PlugIns/ExpoWidgetsTarget.appex is NOT in the installed app (the signing tool may have removed it to save App IDs)',
    };
  }
  if (ext.profileFound && !(ext.profileGroups ?? []).includes(expectedGroup)) {
    return {
      ok: false,
      pending: false,
      line: `Extension: its profile does not include ${expectedGroup} (extension groups: ${list(ext.profileGroups)})`,
    };
  }
  const record = currentRecord(n.records, 'extension', buildNumber);
  if (record === null) {
    return {
      ok: false,
      pending: true,
      line: 'Extension: not seen yet in this build. Run Live Activity (it starts the extension), then run App Group again',
    };
  }
  if (record.group !== expectedGroup) {
    return { ok: false, pending: false, line: `Extension resolved ${record.group}, but the app uses ${expectedGroup}` };
  }
  return { ok: true, line: `Extension resolved ${expectedGroup} and wrote its record to the shared container` };
}

export function analyseAppGroup(e: AppGroupEvidence): ResultUpdate {
  const n = e.native;
  const signedGroups = n?.profileFound === true ? n.profileGroups ?? [] : null;
  const cls = classifyAppGroup(e.configuredGroup, signedGroups);

  const details: string[] = [`Configured group (build time): ${e.configuredGroup}`];
  if (n === null) {
    details.push('Signing profiles: not read (audio-coach native module not in this build)');
  } else {
    details.push(...describeProfile('App', n));
    details.push(`App ALTAppGroups: ${list(n.altAppGroups)}`);
    const ext = n.extension;
    if (ext !== null && ext.present) {
      details.push(`Extension bundle ID: ${ext.bundleId ?? 'unknown'}`);
      details.push(...describeProfile('Extension', ext));
      details.push(`Extension ALTAppGroups: ${list(ext.altAppGroups)}`);
    }
    for (const [group, c] of Object.entries(n.containers)) details.push(describeContainer(group, c));
    if (n.records.length === 0) details.push('Runtime resolution records: none (patched expo-widgets has not run, or this build predates it)');
    for (const r of n.records) details.push(describeRecord(r, e.buildNumber));
    details.push(`NSSupportsLiveActivities: ${yesNo(n.supportsLiveActivities)}`);
    details.push(`Live Activities enabled in Settings: ${yesNo(n.activitiesEnabled)}`);
  }
  details.push(
    `expo-widgets widgetsDirectory (app side): ${e.expoWidgetsDirectory === null || e.expoWidgetsDirectory === '' ? 'none (no container found)' : e.expoWidgetsDirectory}`,
  );
  details.push(
    `expo-file-system shared containers (build-time list): ${e.expoSharedContainers.length === 0 ? 'none resolved' : e.expoSharedContainers.join(', ')}`,
  );
  details.push(
    e.jsWriteRead === null
      ? 'expo-file-system write/read: not attempted (configured group has no container)'
      : `expo-file-system write/read: ${e.jsWriteRead.ok ? 'OK' : `FAILED${e.jsWriteRead.error === undefined ? '' : ` (${e.jsWriteRead.error})`}`}`,
  );

  if (cls.kind === 'missing') {
    return {
      status: 'fail',
      summary: `The installed app was signed without the configured App Group (signed: ${list(cls.signedGroups)})`,
      details,
    };
  }

  const appRecord = n === null ? null : currentRecord(n.records, 'app', e.buildNumber);
  // The group the Live Activity data must go through.
  const expectedGroup =
    cls.kind === 'match' ? e.configuredGroup : cls.kind === 'renamed' ? cls.signedGroup : appRecord?.group ?? e.configuredGroup;
  const containerWritable = n?.containers[expectedGroup]?.writeRead === true;
  const writable = containerWritable || (expectedGroup === e.configuredGroup && e.jsWriteRead?.ok === true);

  // ---- App side ----
  let appProblem: string | null = null;
  if (!writable) {
    appProblem = `the app could not write to ${expectedGroup}'s container`;
  } else if (appRecord !== null && appRecord.group !== expectedGroup) {
    appProblem = `expo-widgets in the app resolved ${appRecord.group}, not ${expectedGroup}`;
  } else if (cls.kind === 'renamed' && appRecord === null) {
    // Stock expo-widgets would still use the build-time group here.
    appProblem =
      'expo-widgets in the app did not resolve the renamed group at runtime (no record: the patch is not in this build or did not run)';
  }
  const label =
    cls.kind === 'renamed'
      ? `Renamed by the signing tool to ${cls.signedGroup} (suffix .${cls.suffix})`
      : cls.kind === 'match'
        ? 'Signed with the configured App Group'
        : `Signing profile not readable; using ${expectedGroup}`;
  if (cls.kind === 'unknown') details.push('Rename could not be checked without the signing profile');

  if (appProblem !== null) {
    return {
      status: 'fail',
      summary: `${label}, but ${appProblem}`,
      details: [...details, 'See ADR 0007 "Known risks"'],
    };
  }

  // ---- Extension side (review F2) ----
  if (n === null) {
    return {
      status: 'fail',
      summary: `${label}; the extension could not be checked (audio-coach native module not in this build)`,
      details,
    };
  }
  const ext = judgeExtension(n, expectedGroup, e.buildNumber);
  details.push(ext.line);
  if (ext.ok) {
    return {
      status: 'pass',
      summary:
        cls.kind === 'renamed'
          ? `${label}: renamed (handled at runtime). App and Live Activity extension both resolve it and can write`
          : `${label}. App and Live Activity extension both resolve it and can write`,
      details,
    };
  }
  if (ext.pending) {
    return {
      status: 'not_run',
      summary: `${label}; app side OK. Extension not checked yet: run Live Activity, then App Group again`,
      details,
    };
  }
  return { status: 'fail', summary: `${label}; app side OK, but the extension is not: ${ext.line}`, details };
}

// ---------- Validation of the native reply (untrusted shape) ----------

function stringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x): x is string => typeof x === 'string') ? v : null;
}

function optionalString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function optionalBoolean(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseProfile(r: Record<string, unknown>): SigningProfile {
  return {
    profileFound: r.profileFound === true,
    profileGroups: stringArray(r.profileGroups),
    profileTeamId: optionalString(r.profileTeamId),
    profileExpiresUtc: optionalString(r.profileExpiresUtc),
  };
}

function parseExtension(v: unknown): ExtensionInfo | null {
  if (!isRecord(v) || typeof v.present !== 'boolean') return null;
  return {
    ...parseProfile(v),
    present: v.present,
    bundleId: optionalString(v.bundleId),
    configuredGroup: optionalString(v.configuredGroup),
    altAppGroups: stringArray(v.altAppGroups),
  };
}

function parseRecord(v: unknown): ResolutionRecord | null {
  if (!isRecord(v)) return null;
  const { role, group, source, bundleId, buildNumber, atUtc, foundIn } = v;
  if (role !== 'app' && role !== 'extension') return null;
  if (
    typeof group !== 'string' ||
    group.length === 0 ||
    typeof source !== 'string' ||
    typeof bundleId !== 'string' ||
    typeof buildNumber !== 'string' ||
    typeof atUtc !== 'string' ||
    typeof foundIn !== 'string'
  ) {
    return null;
  }
  // A record can only prove the group it was found in.
  if (group !== foundIn) return null;
  return { role, group, source, bundleId, buildNumber, atUtc, foundIn };
}

/** Validates the native module's reply; anything malformed becomes "unknown". */
export function parseNativeAppGroupInfo(raw: unknown): NativeAppGroupInfo | null {
  if (!isRecord(raw)) return null;
  const containers: Record<string, ContainerCheck> = {};
  if (isRecord(raw.containers)) {
    for (const [group, c] of Object.entries(raw.containers)) {
      if (!isRecord(c) || typeof c.resolved !== 'boolean') continue;
      const check: ContainerCheck = { resolved: c.resolved };
      if (typeof c.path === 'string') check.path = c.path;
      if (typeof c.writeRead === 'boolean') check.writeRead = c.writeRead;
      if (typeof c.error === 'string') check.error = c.error;
      containers[group] = check;
    }
  }
  const records = Array.isArray(raw.resolutionRecords)
    ? raw.resolutionRecords.map(parseRecord).filter((r): r is ResolutionRecord => r !== null)
    : [];
  return {
    ...parseProfile(raw),
    altAppGroups: stringArray(raw.altAppGroups),
    supportsLiveActivities: optionalBoolean(raw.supportsLiveActivities),
    activitiesEnabled: optionalBoolean(raw.activitiesEnabled),
    extension: parseExtension(raw.extension),
    containers,
    records,
  };
}
