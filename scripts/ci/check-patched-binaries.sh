#!/usr/bin/env bash
# Checks that the patched expo-widgets (patches/expo-widgets+57.0.23.patch,
# ADR 0007) is in the code the app AND the Live Activity extension actually run.
#
# Usage: check-patched-binaries.sh <path/to/App.app>
#
# "Runs" means every Mach-O file the bundle loads:
# - app: its executable and any Mach-O under Frameworks/ (not PlugIns/);
# - extension (PlugIns/ExpoWidgetsTarget.appex): every Mach-O inside the
#   .appex (the executable, and e.g. an Xcode debug dylib), plus each
#   @rpath library its executable loads, resolved through its LC_RPATHs
#   (usually the host app's Frameworks/). Needs otool (macOS); without it,
#   only files inside the bundle are searched, and the output says so.
#
# Markers are strings only the patch contains: a string literal, and the Swift
# type name (in type metadata and symbol names). Non-Mach-O files (JS bundles,
# plists) never count. Prints what it searched and found, and diagnostics on
# failure. Exit 1 if either bundle has no marker in anything it runs.
set -euo pipefail

APP="${1:?usage: check-patched-binaries.sh <App.app>}"
APPEX="$APP/PlugIns/ExpoWidgetsTarget.appex"
MARKERS=(parentAltAppGroups FizzAppGroupResolver)

is_macho() {
  local magic
  magic="$(head -c 4 "$1" 2>/dev/null | od -An -tx1 | tr -d ' \n')"
  case "$magic" in
    cffaedfe | feedfacf | cefaedfe | feedface | cafebabe | bebafeca) return 0 ;;
    *) return 1 ;;
  esac
}

# Executable named in a bundle's Info.plist; falls back to the bundle's base name.
bundle_executable() {
  local bundle="$1" name=""
  if command -v plutil > /dev/null 2>&1; then
    name="$(plutil -extract CFBundleExecutable raw "$bundle/Info.plist" 2> /dev/null || true)"
  fi
  if [ -z "$name" ]; then
    name="$(basename "$bundle")"
    name="${name%.*}"
  fi
  printf '%s\n' "$bundle/$name"
}

# @rpath dependencies of a Mach-O, resolved through its LC_RPATH entries.
rpath_dependencies() {
  local exe="$1" dir rpaths dep rel rp candidate
  command -v otool > /dev/null 2>&1 || return 0
  dir="$(dirname "$exe")"
  rpaths="$(otool -l "$exe" | awk '/cmd LC_RPATH/ { getline; getline; print $2 }' |
    sed -e "s#@executable_path#$dir#" -e "s#@loader_path#$dir#")"
  otool -L "$exe" | awk 'NR > 1 { print $1 }' | grep '^@rpath/' | while read -r dep; do
    rel="${dep#@rpath/}"
    for rp in $rpaths; do
      candidate="$rp/$rel"
      if [ -f "$candidate" ]; then
        printf '%s\n' "$candidate"
        break
      fi
    done
  done
}

# Prints "<file>: <markers found>" per Mach-O searched; returns 0 if any marker was found.
search() {
  local label="$1"
  shift
  local found=1 file m hits
  echo "== $label"
  for file in "$@"; do
    [ -f "$file" ] || continue
    is_macho "$file" || continue
    hits=""
    for m in "${MARKERS[@]}"; do
      if LC_ALL=C grep -a -q -F "$m" "$file"; then hits="$hits $m"; fi
    done
    echo "  ${file#"$APP"/}:${hits:- none}"
    if [ -n "$hits" ]; then found=0; fi
  done
  return "$found"
}

diagnose() {
  local exe="$1"
  echo "-- diagnostics for ${exe#"$APP"/}"
  ls -la "$(dirname "$exe")" || true
  if command -v otool > /dev/null 2>&1; then
    echo "-- otool -L"
    otool -L "$exe" || true
    echo "-- LC_RPATH"
    otool -l "$exe" | awk '/cmd LC_RPATH/ { getline; getline; print $2 }' || true
  else
    echo "(no otool: @rpath libraries not resolved)"
  fi
  if command -v nm > /dev/null 2>&1; then
    echo "-- ExpoWidgets symbols defined in the executable (count; 0 = module not linked in)"
    nm -U "$exe" 2> /dev/null | grep -c '11ExpoWidgets' || true
  fi
  echo "-- related strings in the executable (count, string)"
  LC_ALL=C grep -a -o -E 'ExpoWidgetsAppGroupIdentifier|ALTAppGroups|fizz\.appGroupResolution\.|WidgetsStorage|parentAltAppGroups|FizzAppGroupResolver' "$exe" |
    sort | uniq -c || echo "   none"
}

status=0

APP_EXE="$(bundle_executable "$APP")"
app_files=("$APP_EXE")
if [ -d "$APP/Frameworks" ]; then
  while IFS= read -r f; do app_files+=("$f"); done < <(find "$APP/Frameworks" -type f)
fi
if ! search "app" "${app_files[@]}"; then
  echo "::error::Patched expo-widgets not found in anything the app runs"
  diagnose "$APP_EXE"
  status=1
fi

if [ ! -d "$APPEX" ]; then
  echo "::error::$APPEX is missing"
  exit 1
fi
APPEX_EXE="$(bundle_executable "$APPEX")"
appex_files=()
while IFS= read -r f; do appex_files+=("$f"); done < <(find "$APPEX" -type f)
while IFS= read -r f; do appex_files+=("$f"); done < <(rpath_dependencies "$APPEX_EXE")
if ! command -v otool > /dev/null 2>&1; then
  echo "(no otool: the extension's @rpath libraries were not searched)"
fi
if ! search "extension" "${appex_files[@]}"; then
  echo "::error::Patched expo-widgets not found in anything the widget extension runs"
  diagnose "$APPEX_EXE"
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "Patched expo-widgets is in the code the app and the extension run"
fi
exit "$status"
