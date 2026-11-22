import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** (Rule 10; Ben, 26 Oct; app review finding 13) Profile keeps Your data and Coaching knowledge apart. */
describe('Profile · Your data and Coaching knowledge (rule 10)', () => {
  const src = readFileSync(join(import.meta.dirname, '../src/screens/profile/ProfileScreen.tsx'), 'utf8');
  const section = (title: string): string => {
    const start = src.indexOf(`<SectionHeader title={${title}} />`);
    expect(start, title).toBeGreaterThan(-1);
    const end = src.indexOf('<SectionHeader', start + 1);
    return src.slice(start, end);
  };

  it('uses Data & backup’s names for the two groups', () => {
    expect(src).toContain("export const PROFILE_SECTIONS = { yourData: 'Your data', knowledge: 'Coaching knowledge' } as const;");
  });

  it('Memory and Pain flags are Your data; Playbook is Coaching knowledge; neither sits under Coach', () => {
    const mine = section('PROFILE_SECTIONS.yourData');
    expect(mine).toContain('title="Memory"');
    expect(mine).toContain('title="Pain flags"');
    expect(mine).not.toContain('title="Playbook"');
    const knowledge = section('PROFILE_SECTIONS.knowledge');
    expect(knowledge).toContain('title="Playbook"');
    expect(knowledge).not.toContain('title="Memory"');
    const coach = src.slice(src.indexOf('<SectionHeader title="Coach" />'), src.indexOf('<SectionHeader', src.indexOf('<SectionHeader title="Coach" />') + 1));
    expect(coach).toContain('title="Coach connection"');
    expect(coach).not.toContain('title="Memory"');
    expect(coach).not.toContain('title="Playbook"');
    // Each row appears once.
    expect(src.match(/title="Pain flags"/g)?.length).toBe(1);
  });
});
