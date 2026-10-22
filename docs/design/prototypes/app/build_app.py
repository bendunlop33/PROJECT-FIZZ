#!/usr/bin/env python3
"""Assemble the whole-app prototype (Ben, 22 Oct).

Copies app-shell.html as app.html and each screen prototype next to it, adding a doctype and a small
embed snippet: with ?embed=1 the prototype drops its own frame, controls, status bar and tab bar (the
shell provides them), and its main buttons tell the shell where to go. The original prototypes are
not changed.

After building it checks that the screens agree (V1) and exits non-zero with a list of problems when
they don't: first the shared example facts in the source (FIXTURE, PLAN_WEEK, the muscle list, dates;
see check() below), then a headless click-through of the built app (check_app.mjs: one session reads the
same on Today with and without a plan, the plan overview, the builder, the active workout and the Summary).
The click-through needs Node and Playwright; without them it is reported as skipped, not passed.

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
    # Start asks first when today changed, and Edit sends today's draft to the builder (both handled inside).
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
  // From Today's Start prompt, Update in your plan: today's changes become plan changes to review (Ben, 22 Oct).
  addEventListener('message', (e) => {
    const c = e.data?.cmd === 'edit' && e.data.change; if (!c) return;
    ensureEditing();
    if (c.min) S.length = c.min;
    if (typeof c.ss === 'boolean') S.supersets = c.ss;
    if (c.abs === false) S.absWk = 0;
    if (c.main === 'Incline') S.likes = [...new Set([...S.likes, 'Incline bench press'])];
    S.plan = build(); S.pageTop = true; render();
  });
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
  document.addEventListener('click', (e) => {{
    const b = e.target.closest('button'); if (!b) return;
    const to = GO[b.textContent.trim()]; if (!to) return;
    if (to[0] === '~') {{ parent.postMessage({{ app: to.slice(1) }}, '*'); return; }}
    e.preventDefault(); e.stopPropagation(); parent.postMessage({{ app: to }}, '*');
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
FIXTURE = {
    'today': 'Tue 20 Oct', 'week': '19–25 Oct', 'lastWeek': '12–18 Oct', 'session': 'Chest',
    'main': 'Barbell bench press', 'top': 102.5, 'back': 92.5, 'mainLine': '1 × 6 + 2 × 8 · 102.5 / 92.5',
    'last': '12 Oct · 100 × 6',
}
YEAR = 2026
USES_FIXTURE = ['app.html', 'training-blocks.html', 'workout-builder-v3.html', 'progress-simple.html']
# This week of the plan (Today with a plan and the plan overview): one JSON line, the same in both.
USES_PLAN_WEEK = ['training-blocks.html', 'plan-builder.html']
# One muscle list everywhere (V1): the plan's MUSCLES, and where each screen lists muscles.
MUSCLE_LISTS = {
    'plan-builder.html': r"const MUSCLES = \[(.*?)\];",
    'workout-builder-v3.html': r"const GROUPS = \[(.*?)\];",
    'progress-simple.html': r"const MUSCLES = \[(.*?)\];",
    'training-blocks.html': r"const MUSCLES = \[(.*?)\];",
    'app.html': r"const EXS = (\{.*?\});",
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
    for n, pat in MUSCLE_LISTS.items():
        m = re.search(pat, (out / n).read_text(), re.S)
        if not m:
            bad.append(f'{n}: muscle list not found')
            continue
        names = re.findall(r"\['(\w+)', \[", m[1]) or re.findall(r"(?:\{|\], )\s*'?(\w+)'?: \[", m[1]) or re.findall(r"'(\w+)'", m[1])
        muscles[n] = names
    ref = muscles.get('plan-builder.html')
    bad += [f'{n}: muscles {v} differ from the plan\'s {ref}' for n, v in muscles.items() if v != ref]
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
