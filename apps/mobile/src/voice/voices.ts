/**
 * Installed iOS voices (audio-coach `getVoices`), validated, and the default
 * choice: the best-quality en-GB voice, else en-US, else the system's (null).
 * Pure, tested on Linux.
 */

export type VoiceQuality = 'default' | 'enhanced' | 'premium';

export interface VoiceOption {
  id: string;
  name: string;
  language: string;
  quality: VoiceQuality;
}

const QUALITY_RANK: Record<VoiceQuality, number> = { premium: 3, enhanced: 2, default: 1 };

/** Raw native list to options. Novelty voices (Bells, Bubbles…) and malformed entries are left out. */
export function parseVoices(raw: unknown): VoiceOption[] {
  if (!Array.isArray(raw)) return [];
  const out: VoiceOption[] = [];
  for (const v of raw as unknown[]) {
    if (typeof v !== 'object' || v === null) continue;
    const r = v as Record<string, unknown>;
    if (typeof r.identifier !== 'string' || typeof r.name !== 'string' || typeof r.language !== 'string') continue;
    if (r.novelty === true) continue;
    const quality: VoiceQuality = r.quality === 'premium' || r.quality === 'enhanced' ? r.quality : 'default';
    out.push({ id: r.identifier, name: r.name, language: r.language, quality });
  }
  return out;
}

const primary = (tag: string): string => tag.split(/[-_]/)[0]?.toLowerCase() ?? '';

function better(a: VoiceOption, b: VoiceOption): number {
  return QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality] || a.name.localeCompare(b.name);
}

/**
 * Voices in Ben's language (`en-GB` → every `en-*`), his own region first,
 * then by quality, then by name.
 */
export function voicesForLanguage(voices: readonly VoiceOption[], locale: string): VoiceOption[] {
  const lang = primary(locale);
  const region = locale.replace('_', '-').toLowerCase();
  return voices
    .filter((v) => primary(v.language) === lang)
    .sort((a, b) => Number(b.language.toLowerCase() === region) - Number(a.language.toLowerCase() === region) || better(a, b));
}

/** The best en-GB voice, else the best en-US one, else null (the system default). */
export function defaultVoice(voices: readonly VoiceOption[]): VoiceOption | null {
  for (const lang of ['en-GB', 'en-US']) {
    const best = voices.filter((v) => v.language === lang).sort(better)[0];
    if (best) return best;
  }
  return null;
}

/** The voice speech uses: Ben's choice if it is still on the phone, else the default. `missing`: his choice was removed. */
export function resolveVoice(voices: readonly VoiceOption[], chosenId: string | null): { voice: VoiceOption | null; missing: boolean } {
  if (chosenId !== null) {
    const chosen = voices.find((v) => v.id === chosenId);
    if (chosen) return { voice: chosen, missing: false };
    return { voice: defaultVoice(voices), missing: true };
  }
  return { voice: defaultVoice(voices), missing: false };
}

/** The one-line hint shows only when no Enhanced or Premium voice in Ben's language is installed. */
export function needsBetterVoiceHint(voices: readonly VoiceOption[], locale: string): boolean {
  return !voicesForLanguage(voices, locale).some((v) => v.quality !== 'default');
}

export const BETTER_VOICES_HINT = 'Better voices: Settings › Accessibility › Spoken Content › Voices';

/** `Serena · Premium`, `Daniel · Enhanced`, `Daniel`. */
export function voiceLabel(v: VoiceOption): string {
  return v.quality === 'default' ? v.name : `${v.name} · ${v.quality === 'premium' ? 'Premium' : 'Enhanced'}`;
}
