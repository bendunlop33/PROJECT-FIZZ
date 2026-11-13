import { describe, expect, it } from 'vitest';

import {
  analyseAppGroup,
  bundleIdSuffix,
  classifyAppGroup,
  currentRecord,
  describeResolutionSource,
  isResolutionSource,
  RESOLUTION_SOURCES,
  parseNativeAppGroupInfo,
  type AppGroupEvidence,
  type ExtensionInfo,
  type NativeAppGroupInfo,
  type ResolutionRecord,
} from '../src/probe/app-group';

const GROUP = 'group.com.projectfizz.fizz';
const RENAMED = `${GROUP}.ABCDE12345`;

const BUILD = '8';

const record = (over: Partial<ResolutionRecord>): ResolutionRecord => ({
  role: 'app',
  group: GROUP,
  source: 'configured',
  bundleId: 'com.projectfizz.fizz',
  buildNumber: BUILD,
  atUtc: '2026-10-09T08:00:00Z',
  foundIn: GROUP,
  ...over,
});

const extension = (over: Partial<ExtensionInfo>): ExtensionInfo => ({
  present: true,
  bundleId: 'com.projectfizz.fizz.ExpoWidgetsTarget',
  configuredGroup: GROUP,
  altAppGroups: null,
  profileFound: true,
  profileGroups: [GROUP],
  profileTeamId: 'ABCDE12345',
  profileExpiresUtc: '2026-10-15T09:00:00Z',
  ...over,
});

const native = (over: Partial<NativeAppGroupInfo>): NativeAppGroupInfo => ({
  profileFound: true,
  profileGroups: [GROUP],
  profileTeamId: 'ABCDE12345',
  profileExpiresUtc: '2026-10-15T09:00:00Z',
  altAppGroups: null,
  supportsLiveActivities: true,
  activitiesEnabled: true,
  extension: extension({}),
  containers: { [GROUP]: { resolved: true, path: '/private/var/shared/X', writeRead: true } },
  records: [record({}), record({ role: 'extension', bundleId: 'com.projectfizz.fizz.ExpoWidgetsTarget' })],
  ...over,
});

const evidence = (over: Partial<AppGroupEvidence>): AppGroupEvidence => ({
  configuredGroup: GROUP,
  buildNumber: BUILD,
  expoSharedContainers: [GROUP],
  jsWriteRead: { ok: true },
  expoWidgetsDirectory: 'file:///private/var/shared/X/ExpoWidgets/',
  native: native({}),
  ...over,
});

/** SideStore as seen on build 7, with the runtime fix working on both sides. */
const renamedNative = (over: Partial<NativeAppGroupInfo>): NativeAppGroupInfo =>
  native({
    profileGroups: [RENAMED],
    altAppGroups: [RENAMED],
    extension: extension({
      bundleId: 'com.projectfizz.fizz.ABCDE12345.ExpoWidgetsTarget',
      profileGroups: [RENAMED],
      altAppGroups: [RENAMED],
    }),
    containers: { [GROUP]: { resolved: false }, [RENAMED]: { resolved: true, path: '/p', writeRead: true } },
    records: [
      record({ group: RENAMED, foundIn: RENAMED, source: 'altAppGroups' }),
      record({ role: 'extension', group: RENAMED, foundIn: RENAMED, source: 'altAppGroups' }),
    ],
    ...over,
  });

const renamedEvidence = (over: Partial<NativeAppGroupInfo>): AppGroupEvidence =>
  evidence({ expoSharedContainers: [], jsWriteRead: null, native: renamedNative(over) });

describe('classifyAppGroup', () => {
  it('matches, detects a team-suffix rename, a missing group, and no evidence', () => {
    expect(classifyAppGroup(GROUP, [GROUP])).toEqual({ kind: 'match' });
    expect(classifyAppGroup(GROUP, [RENAMED])).toEqual({ kind: 'renamed', signedGroup: RENAMED, suffix: 'ABCDE12345' });
    expect(classifyAppGroup(GROUP, ['group.other'])).toEqual({ kind: 'missing', signedGroups: ['group.other'] });
    expect(classifyAppGroup(GROUP, [])).toEqual({ kind: 'missing', signedGroups: [] });
    expect(classifyAppGroup(GROUP, null)).toEqual({ kind: 'unknown' });
  });

  it('does not treat a group that merely shares a prefix as a rename', () => {
    expect(classifyAppGroup(GROUP, [`${GROUP}x`]).kind).toBe('missing');
  });
});

describe('analyseAppGroup: configured group kept', () => {
  it('passes when the app can write and the extension resolved the same group', () => {
    const r = analyseAppGroup(evidence({}));
    expect(r.status).toBe('pass');
    expect(r.summary).toContain('App and Live Activity extension both resolve it');
    expect(r.details).toContain('App profile expires: 2026-10-15T09:00:00Z');
    expect(r.details).toContain(`Extension resolved ${GROUP} and wrote its record to the shared container`);
  });

  it('fails when the configured group is signed but nothing could write to it', () => {
    const r = analyseAppGroup(
      evidence({ jsWriteRead: { ok: false, error: 'denied' }, native: native({ containers: { [GROUP]: { resolved: true, writeRead: false } } }) }),
    );
    expect(r.status).toBe('fail');
    expect(r.summary).toContain(`could not write to ${GROUP}`);
  });

  it('fails when the profile has no matching group', () => {
    expect(analyseAppGroup(evidence({ native: native({ profileGroups: [] }) })).summary).toMatch(
      /signed without the configured App Group \(signed: none\)/,
    );
  });

  it('without a readable app profile, judges by container access and says the rename was not checked', () => {
    const r = analyseAppGroup(evidence({ native: native({ profileFound: false, profileGroups: null }) }));
    expect(r.status).toBe('pass');
    expect(r.details).toContain('Rename could not be checked without the signing profile');
    expect(r.details).toContain('App signing profile: no embedded.mobileprovision found');
  });

  it('without the native module, fails honestly', () => {
    const r = analyseAppGroup(evidence({ native: null, expoSharedContainers: [], jsWriteRead: null }));
    expect(r.status).toBe('fail');
    expect(r.details).toContain('Signing profiles: not read (audio-coach native module not in this build)');
  });

  it('with the native module but no container write, still fails before looking at the extension', () => {
    const r = analyseAppGroup(evidence({ native: null, jsWriteRead: { ok: true } }));
    expect(r.status).toBe('fail');
    expect(r.summary).toContain('extension could not be checked');
  });
});

describe('analyseAppGroup: SideStore rename (ADR 0007 runtime fix)', () => {
  it('passes as "renamed (handled at runtime)" only when app and extension both resolve the renamed group', () => {
    const r = analyseAppGroup(renamedEvidence({}));
    expect(r.status).toBe('pass');
    expect(r.summary).toContain(`Renamed by the signing tool to ${RENAMED} (suffix .ABCDE12345)`);
    expect(r.summary).toContain('renamed (handled at runtime)');
    expect(r.details).toContain(`${GROUP}: no container (not entitled to this group)`);
    expect(r.details).toContain(`App resolved ${RENAMED} from ALTAppGroups (altAppGroups) at 2026-10-09T08:00:00Z (build 8, com.projectfizz.fizz)`);
    expect(r.details).toContain('Extension ALTAppGroups: ' + RENAMED);
  });

  it('fails like build 7 when the app has no runtime record (stock expo-widgets)', () => {
    const r = analyseAppGroup(renamedEvidence({ records: [] }));
    expect(r.status).toBe('fail');
    expect(r.summary).toContain('did not resolve the renamed group at runtime');
    expect(r.details).toContain(
      'Runtime resolution records: none (patched expo-widgets has not run, or this build predates it)',
    );
  });

  it('fails when the renamed container is not writable', () => {
    const r = analyseAppGroup(renamedEvidence({ containers: { [RENAMED]: { resolved: true, writeRead: false, error: 'EPERM' } } }));
    expect(r.status).toBe('fail');
    expect(r.summary).toContain(`could not write to ${RENAMED}`);
  });

  it('is incomplete (not a pass) until the extension has run in this build', () => {
    const r = analyseAppGroup(renamedEvidence({ records: [record({ group: RENAMED, foundIn: RENAMED, source: 'altAppGroups' })] }));
    expect(r.status).toBe('not_run');
    expect(r.summary).toContain('run Live Activity, then App Group again');
  });

  it('ignores an extension record left by an older build', () => {
    const r = analyseAppGroup(
      renamedEvidence({
        records: [
          record({ group: RENAMED, foundIn: RENAMED }),
          record({ role: 'extension', group: RENAMED, foundIn: RENAMED, buildNumber: '7' }),
        ],
      }),
    );
    expect(r.status).toBe('not_run');
    expect(r.details?.some((d) => d.includes('OLDER build 7 (ignored)'))).toBe(true);
  });

  it('fails when the extension was removed from the installed app', () => {
    const r = analyseAppGroup(renamedEvidence({ extension: extension({ present: false }) }));
    expect(r.status).toBe('fail');
    expect(r.summary).toContain('ExpoWidgetsTarget.appex is NOT in the installed app');
  });

  it("fails when the extension's own profile lacks the group (F2)", () => {
    const r = analyseAppGroup(renamedEvidence({ extension: extension({ profileGroups: [`${GROUP}.OTHERTEAM`] }) }));
    expect(r.status).toBe('fail');
    expect(r.summary).toContain(`its profile does not include ${RENAMED}`);
  });

  it('fails when the extension resolved a different group from the app', () => {
    const r = analyseAppGroup(
      renamedEvidence({
        records: [
          record({ group: RENAMED, foundIn: RENAMED }),
          record({ role: 'extension', group: GROUP, foundIn: GROUP, source: 'configured' }),
        ],
      }),
    );
    expect(r.status).toBe('fail');
    expect(r.summary).toContain(`Extension resolved ${GROUP}, but the app uses ${RENAMED}`);
  });

  it('cannot pass when the native module does not report the extension', () => {
    const r = analyseAppGroup(renamedEvidence({ extension: null }));
    expect(r.status).toBe('fail');
    expect(r.summary).toContain('this build does not report it');
  });

  it('reports Live Activity prerequisites', () => {
    const r = analyseAppGroup(renamedEvidence({ activitiesEnabled: false, supportsLiveActivities: null }));
    expect(r.details).toContain('Live Activities enabled in Settings: NO');
    expect(r.details).toContain('NSSupportsLiveActivities: unknown');
  });
});

describe('currentRecord', () => {
  it('picks the newest record for the role from this build', () => {
    const records = [
      record({ atUtc: '2026-10-09T08:00:00Z' }),
      record({ atUtc: '2026-10-09T09:00:00Z', group: RENAMED, foundIn: RENAMED }),
      record({ atUtc: '2026-10-09T10:00:00Z', buildNumber: '7' }),
      record({ role: 'extension', atUtc: '2026-10-09T11:00:00Z' }),
    ];
    expect(currentRecord(records, 'app', BUILD)?.group).toBe(RENAMED);
    expect(currentRecord(records, 'extension', '7')).toBeNull();
  });
});

describe('parseNativeAppGroupInfo', () => {
  it('keeps valid fields and treats malformed ones as unknown', () => {
    const parsed = parseNativeAppGroupInfo({
      profileFound: true,
      profileGroups: [GROUP, 3],
      profileTeamId: 'T',
      altAppGroups: [RENAMED],
      supportsLiveActivities: 'yes',
      containers: { [GROUP]: { resolved: true, writeRead: 'yes' }, bad: 'x', worse: { path: '/p' } },
    });
    expect(parsed).toEqual({
      profileFound: true,
      profileGroups: null,
      profileTeamId: 'T',
      profileExpiresUtc: null,
      altAppGroups: [RENAMED],
      supportsLiveActivities: null,
      activitiesEnabled: null,
      extension: null,
      containers: { [GROUP]: { resolved: true } },
      records: [],
    });
  });

  it('parses the extension and resolution records, dropping malformed or misplaced records', () => {
    const good = { role: 'extension', group: RENAMED, source: 'altAppGroups', bundleId: 'b', buildNumber: '8', atUtc: 't', foundIn: RENAMED };
    const parsed = parseNativeAppGroupInfo({
      profileFound: false,
      activitiesEnabled: true,
      extension: { present: true, bundleId: 'x.ExpoWidgetsTarget', profileFound: true, profileGroups: [RENAMED], altAppGroups: 'no' },
      containers: {},
      resolutionRecords: [
        good,
        { ...good, role: 'widget' },
        { ...good, buildNumber: 8 },
        // A record can only vouch for the group whose defaults it was found in.
        { ...good, foundIn: GROUP },
        'junk',
      ],
    });
    expect(parsed?.extension).toEqual({
      present: true,
      bundleId: 'x.ExpoWidgetsTarget',
      configuredGroup: null,
      altAppGroups: null,
      profileFound: true,
      profileGroups: [RENAMED],
      profileTeamId: null,
      profileExpiresUtc: null,
    });
    expect(parsed?.activitiesEnabled).toBe(true);
    expect(parsed?.records).toEqual([good]);
  });

  it('treats an extension without a present flag as not reported', () => {
    expect(parseNativeAppGroupInfo({ extension: { bundleId: 'x' } })?.extension).toBeNull();
  });

  it('returns null for a non-object', () => {
    expect(parseNativeAppGroupInfo(null)).toBeNull();
    expect(parseNativeAppGroupInfo('x')).toBeNull();
    expect(parseNativeAppGroupInfo([])).toBeNull();
  });
});

/**
 * Build 475 (28 Oct 2026), Ti800's SideStore fork: both bundles signed with
 * the renamed group, but no ALTAppGroups in either Info.plist.
 */
const TI800 = `${GROUP}.MDP255CUTA`;
const ti800Native = (records: ResolutionRecord[]): NativeAppGroupInfo =>
  native({
    profileGroups: [TI800],
    profileTeamId: 'MDP255CUTA',
    altAppGroups: null,
    extension: extension({
      bundleId: 'com.projectfizz.fizz.MDP255CUTA.ExpoWidgetsTarget',
      profileGroups: [TI800],
      altAppGroups: null,
    }),
    containers: { [GROUP]: { resolved: false }, [TI800]: { resolved: true, path: '/p', writeRead: true } },
    records,
  });

describe('analyseAppGroup: signing tool that writes no ALTAppGroups (build 475, Ti800 SideStore)', () => {
  const ti800Evidence = (records: ResolutionRecord[]): AppGroupEvidence =>
    evidence({ buildNumber: '476', expoSharedContainers: [], jsWriteRead: null, expoWidgetsDirectory: null, native: ti800Native(records) });

  it('reproduces build 475: the app resolved nothing, so it fails with no records', () => {
    const r = analyseAppGroup(ti800Evidence([]));
    expect(r.status).toBe('fail');
    expect(r.summary).toBe(
      `Renamed by the signing tool to ${TI800} (suffix .MDP255CUTA), but expo-widgets in the app did not resolve the renamed group at runtime (no record: the patch is not in this build or did not run)`,
    );
    expect(r.details).toContain('App ALTAppGroups: unknown');
    expect(r.details).toContain('Extension ALTAppGroups: unknown');
  });

  it('passes when the app and the extension both resolve the renamed group from their signing profiles', () => {
    const rec = (over: Partial<ResolutionRecord>) =>
      record({ group: TI800, foundIn: TI800, source: 'profile', buildNumber: '476', bundleId: 'com.projectfizz.fizz.MDP255CUTA', ...over });
    const r = analyseAppGroup(ti800Evidence([rec({}), rec({ role: 'extension', bundleId: 'com.projectfizz.fizz.MDP255CUTA.ExpoWidgetsTarget' })]));
    expect(r.status).toBe('pass');
    expect(r.summary).toContain('renamed (handled at runtime)');
    expect(r.details).toContain(`App resolved ${TI800} from its signing profile (profile) at 2026-10-09T08:00:00Z (build 476, com.projectfizz.fizz.MDP255CUTA)`);
  });

  it('passes with the extension resolving from the parent app’s profile or the bundle ID suffix', () => {
    for (const source of ['parentProfile', 'bundleIdSuffix'] as const) {
      const r = analyseAppGroup(
        ti800Evidence([
          record({ group: TI800, foundIn: TI800, source: 'profile', buildNumber: '476' }),
          record({ role: 'extension', group: TI800, foundIn: TI800, source, buildNumber: '476' }),
        ]),
      );
      expect(r.status).toBe('pass');
      expect((r.details ?? []).some((d) => d.startsWith(`Extension resolved ${TI800} from ${RESOLUTION_SOURCES[source]} (${source})`))).toBe(true);
    }
  });

  it('is incomplete until the extension has run (app resolved, no extension record yet)', () => {
    const r = analyseAppGroup(ti800Evidence([record({ group: TI800, foundIn: TI800, source: 'bundleIdSuffix', buildNumber: '476' })]));
    expect(r.status).toBe('not_run');
  });
});

describe('resolution sources', () => {
  it('names every source the patched resolver writes, in its order; an unknown one is shown raw', () => {
    expect(Object.keys(RESOLUTION_SOURCES)).toEqual(['altAppGroups', 'parentAltAppGroups', 'profile', 'parentProfile', 'bundleIdSuffix', 'configured']);
    expect(describeResolutionSource('parentProfile')).toBe('the app’s signing profile (parentProfile)');
    expect(describeResolutionSource('somethingNew')).toBe('somethingNew');
    expect(isResolutionSource('toString')).toBe(false);
  });
});

describe('bundleIdSuffix', () => {
  it('returns the suffix a signing tool appended, else null', () => {
    expect(bundleIdSuffix('com.projectfizz.fizz.ABCDE12345', 'com.projectfizz.fizz')).toBe('ABCDE12345');
    expect(bundleIdSuffix('com.projectfizz.fizz', 'com.projectfizz.fizz')).toBeNull();
    expect(bundleIdSuffix('com.other.app', 'com.projectfizz.fizz')).toBeNull();
    expect(bundleIdSuffix('com.projectfizz.fizz.', 'com.projectfizz.fizz')).toBeNull();
  });
});
