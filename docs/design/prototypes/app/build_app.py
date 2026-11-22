#!/usr/bin/env python3
"""Assemble the whole-app prototype (Ben, 22 Oct).

Copies app-shell.html as app.html and each screen prototype next to it, adding a doctype and a small
embed snippet: with ?embed=1 the prototype drops its own frame, controls, status bar and tab bar (the
shell provides them), and its main buttons tell the shell where to go. The original prototypes are
not changed.

After building it checks that the screens agree (V1) and exits non-zero with a list of problems when
they don't: first the shared example facts in the source (FIXTURE, PLAN_WEEK, the counting muscles and the
broad picking groups, dates, and that every copy of the shared back-off and fit code is the same; see check()
below), then a headless click-through of the built app (check_app.mjs: one session reads the same on Today with
and without a plan, the plan overview, the builder, the active workout and the Summary, plus Ben's 22 and 23 Oct
decisions D1–D9: Start just starts, Keep for next time? lists only Ben's own structure changes, lean Today that
keeps Your workout's edits, coach offers that go stale, the back-off band and its fallback, the fit, broad picking
groups, plan setup).
The click-through needs Node and Playwright; without them it is reported as skipped, not passed.
Decision labels in the prototypes read "(Ben, 22 and 23 Oct)": a range such as 22–23 Oct reads as a week here.

Usage: python3 build_app.py OUT_DIR [--static-only]
"""
import datetime
import json
import pathlib
import re
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
PROTOS = HERE.parent

# Button text (exact) -> where the shell goes.
GO = {
    # Start always just starts (D1, Ben 22 and 23 Oct) and Edit sends today's draft to the builder (both handled inside).
    'training-blocks.html': {'Build your own': 'builder'},
    # Start sends the workout itself, so the active workout opens with exactly that session (V1).
    'workout-builder-v3.html': {'Start with no muscle groups': 'active'},
    # Finish sends what was logged for the Summary (V1). Discard confirms inside, then posts 'discarded'.
    'workout-active-v3.html': {},
    # '~' = tell the shell but let the prototype handle the tap too. End plan confirms inside, then posts 'endplan'.
    'plan-builder.html': {'Apply plan': 'applied', 'Apply changes': '~changed', 'Close': 'back', 'Pause plan': '~paused', 'Resume plan': '~resumed'},  # Open in builder › sends that day's workout (handled inside)
    'progress-simple.html': {},
}

# Per-file additions.
EXTRA = {
    'plan-builder.html': """
  // #view opens the plan you have, as the Your plan overview (Library › your plan): week 3 of 6 as Today shows it,
  // this week's Back done (openYourPlan in plan-builder.html).
  if (location.hash === '#view') addEventListener('load', () => openYourPlan());
  // (D1, Ben 22 and 23 Oct) Today has no Start prompt, so nothing sends today's changes here any more: a structure
  // change is offered once on the Summary (Keep for next time?) for that plan day only.
""",
    'training-blocks.html': """
  // #progress opens the block's progress screen (the shell's Progress → Block).
  if (location.hash === '#progress') addEventListener('load', () => document.querySelector('[data-a="tab"][data-v="progress"]')?.click());
  // Do today from the plan view: show that day on Today's card.
  addEventListener('message', (e) => { if (e.data?.cmd === 'day') document.querySelector(`[data-a="dayp"][data-v="${e.data.day}"]`)?.click(); });
""",
}

SNIPPET = """<script>
// Whole-app prototype embed mode (Ben, 22 Oct): inside app.html the shell provides the frame, status bar and tabs.
(function () {{
  if (!new URLSearchParams(location.search).has('embed')) return;
  document.documentElement.classList.add('embed');
  const GO = {go};
  // window.embedInfo (optional, set by a prototype) adds facts the shell needs, e.g. the plan's Main focus (review S7).
  const info = (to) => (typeof window.embedInfo === 'function' ? window.embedInfo(to) : {{}});
  document.addEventListener('click', (e) => {{
    const b = e.target.closest('button'); if (!b) return;
    const to = GO[b.textContent.trim()]; if (!to) return;
    if (to[0] === '~') {{ parent.postMessage(Object.assign({{ app: to.slice(1) }}, info(to)), '*'); return; }}
    e.preventDefault(); e.stopPropagation(); parent.postMessage(Object.assign({{ app: to }}, info(to)), '*');
  }}, true);
{extra}}})();
</script>
<style>
.embed body {{ background: var(--canvas); }}
.embed .wrap {{ padding: 0 !important; gap: 0 !important; display: block !important; }}
.embed .ctrl, .embed .hint, .embed .phone .status, .embed .phone .tabs {{ display: none !important; }}
.embed .phone {{ width: 100% !important; max-width: none !important; height: 100vh !important; height: 100dvh !important; border: 0 !important; border-radius: 0 !important; margin: 0 !important; }}
</style>
"""

HEAD = '<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n'


# Shared example facts (V1): one session, one date, one main-lift format across the whole app. Every screen
# that shows them declares the same `const FIXTURE = {...};` (one line of JSON) and renders from it; the screens
# also check their own default session against it at load (console.error, which the click-through tests fail on).
# Back-offs are worked out from their reps and effort (D4, Ben 22 and 23 Oct; training guide SS4): top 6 @ RPE 8 and
# back-offs 8 @ RPE 8 give 97.4, snapped down to 95 (7 % below the top, inside Balanced's 4–10 %). Was a fixed 90 %.
FIXTURE = {
    'today': 'Tue 20 Oct', 'week': '19–25 Oct', 'lastWeek': '12–18 Oct', 'session': 'Chest',
    'main': 'Barbell bench press', 'top': 102.5, 'back': 95, 'mainLine': '1 × 6 + 2 × 8 · 102.5 / 95',
    'last': '12 Oct · 100 × 6',
}
YEAR = 2026
USES_FIXTURE = ['app.html', 'training-blocks.html', 'workout-builder-v3.html', 'progress-simple.html']
# This week of the plan (Today with a plan and the plan overview): one JSON line, the same in both.
USES_PLAN_WEEK = ['training-blocks.html', 'plan-builder.html']
# Muscles (D5, Ben 22 and 23 Oct): the detailed list for COUNTING (plan weekly sets, Progress, Library's exercise lists) is
# the plan's MUSCLES everywhere; the broad groups for PICKING (plan priorities, builder Set up / Add / Swap, Library
# filters) are the plan's GROUPS everywhere, and each broad group is exactly the sum of its detailed parts.
COUNT_LISTS = {
    'plan-builder.html': r"const MUSCLES = \[(.*?)\];",
    'progress-simple.html': r"const MUSCLES = \[(.*?)\];",
    'training-blocks.html': r"const MUSCLES = \[(.*?)\];",
    'app.html': r"const EXS = (\{.*?\});",
}
PICK_MAPS = {
    'plan-builder.html': r"const GROUPS = (\{.*?\});",
    'workout-builder-v3.html': r"const BROAD = (\{.*?\});",
    'app.html': r"const PICK = (\{.*?\});",
}
PICK_LISTS = {
    'workout-builder-v3.html': r"const GROUPS = \[(.*?)\];",
}
# Code that must be the same in every prototype that has it (review B1, B2, S2): the back-off rule (D4), the shared
# fit (D9), and how Ben's own edits are replayed and listed for Keep for next time? (D1, D3). Each copy sits between
# `// <TAG>-START` and `// <TAG>-END`; copies are compared line by line, indentation ignored, and check_app.mjs tests
# the app's back-off copy.
SHARED = {
    'BACKOFF': ['app.html', 'training-blocks.html', 'plan-builder.html', 'workout-builder-v3.html', 'workout-active-v3.html'],
    'FIT': ['app.html', 'training-blocks.html'],
    'EDITS': ['training-blocks.html', 'workout-builder-v3.html'],
}
MONTHS = {m: i + 1 for i, m in enumerate(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])}
MON = '(Aug|Sep|Oct|Nov|Dec)'
OLD_MAIN_FORMATS = [r'Top \$\{[^}]*\} × [^`]*· \$\{[^}]*\} × ', r'Top \d[\d.]* × \d+ · \d', r'\b\d+ sets @ \d']


def day(d: str, m: str) -> datetime.date:
    return datetime.date(YEAR, MONTHS[m], int(d))


def check_text(name: str, text: str) -> list:
    """Date labels must be real dates of the fixture's year, weeks run Monday to Sunday, main lifts use one format."""
    bad = []
    for m in re.finditer(r'\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]* (\d{1,2}) ' + MON + r'\b', text):
        if day(m[2], m[3]).strftime('%a') != m[1]:
            bad.append(f'{name}: "{m[0]}" is a {day(m[2], m[3]).strftime("%A")} in {YEAR}')
    for m in re.finditer(r'\b(\d{1,2})–(\d{1,2}) ' + MON + r'\b', text):
        a, b = day(m[1], m[3]), day(m[2], m[3])
        if a.weekday() != 0 or (b - a).days != 6:
            bad.append(f'{name}: week "{m[0]}" is not Monday to Sunday')
    # Week labels: WEEKS arrays and ['<date>', [ rows (past weeks) are the Monday of each week.
    weeks = [w for arr in re.findall(r'const WEEKS = \[([^\]]*)\]', text) for w in re.findall(r"'(\d{1,2}) " + MON + "'", arr)]
    weeks += re.findall(r"\['(\d{1,2}) " + MON + r"', \[", text)
    for d, m in weeks:
        if day(d, m).weekday() != 0:
            bad.append(f'{name}: week label "{d} {m}" is not a Monday')
    for pat in OLD_MAIN_FORMATS:
        for m in re.finditer(pat, text):
            bad.append(f'{name}: old main-lift format "{m[0]}" (use {FIXTURE["mainLine"]!r})')
    return bad


def check(out: pathlib.Path) -> list:
    bad = []
    if datetime.date(YEAR, 10, 20).strftime('%a %-d %b') != FIXTURE['today']:
        bad.append(f'FIXTURE today {FIXTURE["today"]!r} is not Tue 20 Oct {YEAR}')
    for f in [out / 'app.html', *(out / n for n in GO)]:
        text = f.read_text()
        found = re.findall(r'const FIXTURE = (\{.*?\});', text)
        if f.name in USES_FIXTURE and not found:
            bad.append(f'{f.name}: no shared FIXTURE')
        for raw in found:
            got = json.loads(raw)
            bad += [f'{f.name}: FIXTURE.{k} = {got.get(k)!r}, expected {v!r}' for k, v in FIXTURE.items() if got.get(k) != v]
        bad += check_text(f.name, text)
    weeks = {}
    for n in USES_PLAN_WEEK:
        found = re.findall(r'const PLAN_WEEK = (\{.*?\});\n', (out / n).read_text())
        if len(found) != 1:
            bad.append(f'{n}: expected one PLAN_WEEK, found {len(found)}')
        else:
            weeks[n] = json.loads(found[0])
    if len({json.dumps(w, sort_keys=True) for w in weeks.values()}) > 1:
        bad.append(f'PLAN_WEEK differs between {" and ".join(weeks)}')
    muscles = {}
    for n, pat in COUNT_LISTS.items():
        m = re.search(pat, (out / n).read_text(), re.S)
        if not m:
            bad.append(f'{n}: muscle list not found')
            continue
        names = re.findall(r"\['(\w+)', \[", m[1]) or re.findall(r"(?:\{|\], )\s*'?(\w+)'?: \[", m[1]) or re.findall(r"'(\w+)'", m[1])
        muscles[n] = names
    ref = muscles.get('plan-builder.html')
    bad += [f'{n}: counting muscles {v} differ from the plan\'s {ref}' for n, v in muscles.items() if v != ref]
    # Broad picking groups (D5): one map everywhere, the plan's GROUPS; every detailed muscle in exactly one group.
    maps = {}
    for n, pat in PICK_MAPS.items():
        m = re.search(pat, (out / n).read_text(), re.S)
        if not m:
            bad.append(f'{n}: picking groups not found')
            continue
        maps[n] = [(k, re.findall(r"'(\w+)'", v)) for k, v in re.findall(r"'?(\w+)'?\s*:\s*\[([^\]]*)\]", m[1])]
    pick = maps.get('plan-builder.html')
    bad += [f'{n}: picking groups {v} differ from the plan\'s {pick}' for n, v in maps.items() if v != pick]
    if pick and ref and sorted(p for _, parts in pick for p in parts) != sorted(ref):
        bad.append(f'plan-builder.html: broad groups {pick} are not exactly the sum of the counting list {ref}')
    for n, pat in PICK_LISTS.items():
        m = re.search(pat, (out / n).read_text(), re.S)
        got = re.findall(r"'(\w+)'", m[1]) if m else None
        if pick and got != [k for k, _ in pick]:
            bad.append(f'{n}: picking list {got} differs from the plan\'s groups {[k for k, _ in pick]}')
    # The shared back-off and fit code: one text everywhere.
    for tag, files in SHARED.items():
        seen = {}
        for n in files:
            m = re.search(rf'// {tag}-START.*?// {tag}-END', (out / n).read_text(), re.S)
            if not m:
                bad.append(f'{n}: no shared {tag} block (// {tag}-START … // {tag}-END)')
                continue
            seen[n] = '\n'.join(line.strip() for line in m[0].splitlines())
        if len(set(seen.values())) > 1:
            bad.append(f'shared {tag} block differs between {", ".join(seen)}')
    # The source prototypes not in the app (older or archived) are checked for dates too.
    bad += [x for f in sorted(PROTOS.glob('*.html')) if f.name not in GO for x in check_text(f.name, f.read_text())]
    return bad


def click_through(out: pathlib.Path) -> str:
    """Runs check_app.mjs on the built app: 'ok', 'skipped (why)' or the problems (raises SystemExit)."""
    node = shutil.which('node') or next((p for p in ['/opt/node22/bin/node'] if pathlib.Path(p).exists()), None)
    if not node:
        return 'skipped (Node not found)'
    r = subprocess.run([node, str(HERE / 'check_app.mjs'), str(out)], capture_output=True, text=True, timeout=600)
    if r.returncode == 3:
        return 'skipped (Playwright not found)'
    if r.returncode != 0:
        print(r.stdout + r.stderr, file=sys.stderr, end='')
        sys.exit(1)
    return 'ok'


def main(out: pathlib.Path, static_only: bool = False) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / 'app.html').write_text((HERE / 'app-shell.html').read_text())
    for name, go in GO.items():
        src = (PROTOS / name).read_text()
        snippet = SNIPPET.format(go=json.dumps(go), extra=EXTRA.get(name, ''))
        (out / name).write_text(HEAD + snippet + src)
    print(f'built {len(GO) + 1} files in {out}')
    bad = check(out)
    if bad:
        print(f'FIXTURE CHECK FAILED: {len(bad)} problem(s)', *bad, sep='\n  ', file=sys.stderr)
        sys.exit(1)
    print('fixture check: ok')
    if static_only:
        print('click-through check: skipped (--static-only)')
        return
    res = click_through(out)
    print(f'click-through check: {res}', file=sys.stderr if res.startswith('skipped') else sys.stdout)


if __name__ == '__main__':
    main(pathlib.Path(sys.argv[1]), '--static-only' in sys.argv[2:])
