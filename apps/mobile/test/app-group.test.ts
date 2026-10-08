import { describe, expect, it } from 'vitest';

import {
  analyseAppGroup,
  bundleIdSuffix,
  classifyAppGroup,
  parseNativeAppGroupInfo,
  type AppGroupEvidence,
  type NativeAppGroupInfo,
} from '../src/probe/app-group';

const GROUP = 'group.com.projectfizz.fizz';
const RENAMED = `${GROUP}.ABCDE12345`;

const native = (over: Partial<NativeAppGroupInfo>): NativeAppGroupInfo => ({
  profileFound: true,
  profileGroups: [GROUP],
  profileTeamId: 'ABCDE12345',
  profileExpiresUtc: '2026-10-15T09:00:00Z',
  altAppGroups: null,
  containers: { [GROUP]: { resolved: true, path: '/private/var/shared/X', writeRead: true } },
  ...over,
});

const evidence = (over: Partial<AppGroupEvidence>): AppGroupEvidence => ({
  configuredGroup: GROUP,
  expoSharedContainers: [GROUP],
  jsWriteRead: { ok: true },
  native: native({}),
  ...over,
});

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

describe('analyseAppGroup', () => {
  it('passes only when signed with the configured group and the container is writable', () => {
    const r = analyseAppGroup(evidence({}));
    expect(r.status).toBe('pass');
    expect(r.details).toContain('Profile expires: 2026-10-15T09:00:00Z');
  });

  it('fails when the configured group is signed but nothing could write to it', () => {
    const r = analyseAppGroup(
      evidence({ jsWriteRead: { ok: false, error: 'denied' }, native: native({ containers: { [GROUP]: { resolved: true, writeRead: false } } }) }),
    );
    expect(r.status).toBe('fail');
  });

  it('reports a SideStore-style rename as a failure naming both groups and the suffix', () => {
    const r = analyseAppGroup(
      evidence({
        expoSharedContainers: [],
        jsWriteRead: null,
        native: native({
          profileGroups: [RENAMED],
          containers: { [GROUP]: { resolved: false }, [RENAMED]: { resolved: true, path: '/p', writeRead: true } },
        }),
      }),
    );
    expect(r.status).toBe('fail');
    expect(r.summary).toContain(RENAMED);
    expect(r.summary).toContain('suffix .ABCDE12345');
    expect(r.summary).toContain(`looks for ${GROUP}`);
    expect(r.details).toContain(`${GROUP}: no container (not entitled to this group)`);
    expect(r.details).toContain("Renamed group's container is writable");
    expect(r.details).toContain('expo-file-system shared containers (build-time list): none resolved');
  });

  it('fails when the profile has no matching group', () => {
    expect(analyseAppGroup(evidence({ native: native({ profileGroups: [] }) })).summary).toMatch(/signed without the configured App Group \(signed: none\)/);
  });

  it('without a readable profile, passes on container access but says the rename was not checked', () => {
    const r = analyseAppGroup(evidence({ native: native({ profileFound: false, profileGroups: null }) }));
    expect(r.status).toBe('pass');
    expect(r.details).toContain('Rename could not be checked without the signing profile');
    expect(r.details).toContain('Signing profile: no embedded.mobileprovision found');
  });

  it('without the native module or a container, fails honestly', () => {
    const r = analyseAppGroup(evidence({ native: null, expoSharedContainers: [], jsWriteRead: null }));
    expect(r.status).toBe('fail');
    expect(r.details).toContain('Signing profile: not read (audio-coach native module not in this build)');
  });
});

describe('parseNativeAppGroupInfo', () => {
  it('keeps valid fields and treats malformed ones as unknown', () => {
    const parsed = parseNativeAppGroupInfo({
      profileFound: true,
      profileGroups: [GROUP, 3],
      profileTeamId: 'T',
      altAppGroups: [RENAMED],
      containers: { [GROUP]: { resolved: true, writeRead: 'yes' }, bad: 'x', worse: { path: '/p' } },
    });
    expect(parsed).toEqual({
      profileFound: true,
      profileGroups: null,
      profileTeamId: 'T',
      profileExpiresUtc: null,
      altAppGroups: [RENAMED],
      containers: { [GROUP]: { resolved: true } },
    });
  });

  it('returns null for a non-object', () => {
    expect(parseNativeAppGroupInfo(null)).toBeNull();
    expect(parseNativeAppGroupInfo('x')).toBeNull();
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
