/**
 * Free-provisioning gate for the iOS build (ADR 0004).
 *
 * Fails (exit 1) if any entitlement or Info.plist setting a free Apple ID can't
 * provision appears, or if the bundle ID differs from apps/mobile/app-identity.mts.
 *
 *   node scripts/check-entitlements.ts --prebuild apps/mobile/ios
 *       After `expo prebuild`: every *.entitlements file (Pods excluded), the
 *       app Info.plist, and PRODUCT_BUNDLE_IDENTIFIER in the Xcode project.
 *   node scripts/check-entitlements.ts --signed <entitlements.xml>... [--info-plist <Info.xml>]
 *       In CI, on entitlements extracted from the signed .app/.appex with
 *       `codesign -d --entitlements - --xml`, and the built Info.plist
 *       converted to XML with `plutil -convert xml1`.
 *
 * Runs on Node 22.18+ with built-in type stripping (no build step).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BUNDLE_IDENTIFIER, IOS_PROJECT_NAME, WIDGET_EXTENSION_BUNDLE_IDENTIFIER } from '../apps/mobile/app-identity.mts';
import { checkBackgroundModes, checkEntitlementKeys, type EntitlementFinding } from '../apps/mobile/plugins/entitlement-rules.mts';

// ---------- Minimal XML plist parser (pure) ----------

export type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

interface Token {
  kind: 'open' | 'close' | 'empty' | 'text';
  name: string;
  text: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function tokenize(xml: string): Token[] {
  const body = xml
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const tokens: Token[] = [];
  const re = /<(\/?)([A-Za-z]+)[^>]*?(\/?)>|([^<]+)/g;
  for (let m = re.exec(body); m !== null; m = re.exec(body)) {
    const [, slash, name, selfClose, text] = m;
    if (text !== undefined) {
      tokens.push({ kind: 'text', name: '', text: decodeEntities(text) });
    } else if (name !== undefined) {
      tokens.push({ kind: slash === '/' ? 'close' : selfClose === '/' ? 'empty' : 'open', name, text: '' });
    }
  }
  return tokens;
}

/** Parse an XML property list. Throws on malformed input. */
export function parsePlist(xml: string): PlistValue | null {
  const tokens = tokenize(xml).filter((t) => !(t.kind === 'text' && t.text.trim() === ''));
  let i = 0;
  const next = (): Token => {
    const t = tokens[i++];
    if (t === undefined) throw new SyntaxError('Unexpected end of plist');
    return t;
  };
  const readText = (name: string): string => {
    let text = '';
    for (;;) {
      const t = next();
      if (t.kind === 'text') text += t.text;
      else if (t.kind === 'close' && t.name === name) return text;
      else throw new SyntaxError(`Unexpected <${t.name}> inside <${name}>`);
    }
  };
  const readValue = (t: Token): PlistValue => {
    if (t.kind === 'empty') {
      if (t.name === 'true') return true;
      if (t.name === 'false') return false;
      if (t.name === 'string') return '';
      if (t.name === 'array') return [];
      if (t.name === 'dict') return {};
      throw new SyntaxError(`Unsupported empty <${t.name}/>`);
    }
    if (t.kind !== 'open') throw new SyntaxError(`Expected a value, got ${t.kind} ${t.name}`);
    switch (t.name) {
      case 'string':
      case 'date':
      case 'data':
        return readText(t.name);
      case 'integer':
      case 'real':
        return Number(readText(t.name).trim());
      case 'array': {
        const out: PlistValue[] = [];
        for (let c = next(); !(c.kind === 'close' && c.name === 'array'); c = next()) out.push(readValue(c));
        return out;
      }
      case 'dict': {
        const out: Record<string, PlistValue> = {};
        for (let c = next(); !(c.kind === 'close' && c.name === 'dict'); c = next()) {
          if (c.kind !== 'open' || c.name !== 'key') throw new SyntaxError('Expected <key> in <dict>');
          const key = readText('key');
          out[key] = readValue(next());
        }
        return out;
      }
      default:
        throw new SyntaxError(`Unsupported <${t.name}>`);
    }
  };
  if (tokens.length === 0) return null;
  const first = next();
  if (first.kind === 'empty' && first.name === 'plist') return null;
  if (first.kind !== 'open' || first.name !== 'plist') throw new SyntaxError('Missing <plist> root');
  const after = next();
  if (after.kind === 'close' && after.name === 'plist') return null;
  const value = readValue(after);
  const end = next();
  if (end.kind !== 'close' || end.name !== 'plist') throw new SyntaxError('Expected </plist>');
  return value;
}

function asDict(v: PlistValue | null): Record<string, PlistValue> {
  if (v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new SyntaxError('Plist root is not a <dict>');
  return v;
}

// ---------- Checks (pure) ----------

export interface Finding extends EntitlementFinding {
  source: string;
}

export function checkEntitlementsXml(xml: string, source: string): Finding[] {
  const dict = asDict(parsePlist(xml));
  const keys = Object.keys(dict);
  if (keys.length === 0) {
    return [
      {
        source,
        key: '(none)',
        severity: 'warning',
        message: 'No entitlements. SideStore may then skip App Group registration (free-ios-install.md §2)',
      },
    ];
  }
  return checkEntitlementKeys(keys).map((f) => ({ ...f, source }));
}

export function checkInfoPlistXml(xml: string, source: string, expectedBundleId: string | null): Finding[] {
  const dict = asDict(parsePlist(xml));
  const findings: Finding[] = [];
  const modes = dict.UIBackgroundModes;
  if (Array.isArray(modes)) {
    const strings = modes.filter((m): m is string => typeof m === 'string');
    findings.push(...checkBackgroundModes(strings).map((f) => ({ ...f, source })));
  }
  if (dict.ExpoWidgets_EnablePushNotifications === true) {
    findings.push({
      source,
      key: 'ExpoWidgets_EnablePushNotifications',
      severity: 'error',
      message: 'Live Activity push is enabled; free Apple IDs have no push',
    });
  }
  if (expectedBundleId !== null) {
    const id = dict.CFBundleIdentifier;
    if (id !== expectedBundleId) {
      findings.push({
        source,
        key: 'CFBundleIdentifier',
        severity: 'error',
        message: `Bundle ID is ${JSON.stringify(id)}, expected ${expectedBundleId}. Changing it orphans Ben's data (ADR 0004)`,
      });
    }
  }
  return findings;
}

/** Checks PRODUCT_BUNDLE_IDENTIFIER values in a project.pbxproj. */
export function checkPbxprojBundleIds(pbxproj: string, source: string, allowed: readonly string[]): Finding[] {
  const ids = new Set<string>();
  for (const m of pbxproj.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/g)) {
    if (m[1] !== undefined) ids.add(m[1]);
  }
  const findings: Finding[] = [];
  if (!ids.has(BUNDLE_IDENTIFIER)) {
    findings.push({
      source,
      key: 'PRODUCT_BUNDLE_IDENTIFIER',
      severity: 'error',
      message: `App bundle ID ${BUNDLE_IDENTIFIER} not found in the Xcode project (found: ${[...ids].join(', ') || 'none'})`,
    });
  }
  for (const id of ids) {
    if (!allowed.includes(id)) {
      findings.push({ source, key: 'PRODUCT_BUNDLE_IDENTIFIER', severity: 'error', message: `Unexpected bundle ID ${id}` });
    }
  }
  return findings;
}

// ---------- CLI ----------

function findEntitlementFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'Pods' || entry === 'build' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...findEntitlementFiles(p));
    else if (entry.endsWith('.entitlements')) out.push(p);
  }
  return out;
}

export function runPrebuildChecks(iosDir: string): Finding[] {
  const findings: Finding[] = [];
  const files = findEntitlementFiles(iosDir);
  if (files.length === 0) {
    findings.push({ source: iosDir, key: '(none)', severity: 'warning', message: 'No .entitlements files found' });
  }
  for (const f of files) findings.push(...checkEntitlementsXml(readFileSync(f, 'utf8'), f));
  const infoPlist = join(iosDir, IOS_PROJECT_NAME, 'Info.plist');
  if (existsSync(infoPlist)) {
    // Source Info.plist holds $(PRODUCT_BUNDLE_IDENTIFIER); the pbxproj check covers the ID.
    findings.push(...checkInfoPlistXml(readFileSync(infoPlist, 'utf8'), infoPlist, null));
  } else {
    findings.push({ source: infoPlist, key: 'Info.plist', severity: 'error', message: 'App Info.plist not found' });
  }
  const pbxproj = join(iosDir, `${IOS_PROJECT_NAME}.xcodeproj`, 'project.pbxproj');
  if (existsSync(pbxproj)) {
    findings.push(
      ...checkPbxprojBundleIds(readFileSync(pbxproj, 'utf8'), pbxproj, [BUNDLE_IDENTIFIER, WIDGET_EXTENSION_BUNDLE_IDENTIFIER]),
    );
  } else {
    findings.push({ source: pbxproj, key: 'project.pbxproj', severity: 'error', message: 'Xcode project not found' });
  }
  return findings;
}

export function formatFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) return 'Entitlement check: OK (no forbidden keys)';
  return findings.map((f) => `${f.severity === 'error' ? 'ERROR' : 'warning'} [${basename(f.source)}] ${f.message}`).join('\n');
}

function main(argv: readonly string[]): number {
  const findings: Finding[] = [];
  const [mode, ...rest] = argv;
  if (mode === '--prebuild' && rest[0] !== undefined) {
    findings.push(...runPrebuildChecks(rest[0]));
  } else if (mode === '--signed' && rest.length > 0) {
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--info-plist') {
        const file = rest[++i];
        if (file === undefined) throw new Error('--info-plist needs a file');
        findings.push(...checkInfoPlistXml(readFileSync(file, 'utf8'), file, BUNDLE_IDENTIFIER));
      } else if (arg !== undefined) {
        findings.push(...checkEntitlementsXml(readFileSync(arg, 'utf8'), arg));
      }
    }
  } else {
    console.error('Usage: check-entitlements.ts --prebuild <ios dir> | --signed <entitlements.xml>... [--info-plist <Info.xml>]');
    return 2;
  }
  console.log(formatFindings(findings));
  const errors = findings.filter((f) => f.severity === 'error').length;
  if (errors > 0) console.error(`Entitlement check FAILED: ${errors} error(s)`);
  return errors > 0 ? 1 : 0;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = main(process.argv.slice(2));
}
