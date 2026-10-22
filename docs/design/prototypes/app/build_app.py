#!/usr/bin/env python3
"""Assemble the whole-app prototype (Ben, 22 Oct).

Copies app-shell.html as app.html and each screen prototype next to it, adding a doctype and a small
embed snippet: with ?embed=1 the prototype drops its own frame, controls, status bar and tab bar (the
shell provides them), and its main buttons tell the shell where to go. The original prototypes are
not changed.

Usage: python3 build_app.py OUT_DIR
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
PROTOS = HERE.parent

# Button text (exact) -> where the shell goes.
GO = {
    'training-blocks.html': {'Start': 'active', 'Build your own': 'builder', 'Edit': 'builder'},
    'workout-builder-v3.html': {'Start': 'active', 'Start with no muscle groups': 'active'},
    'workout-active-v3.html': {'Finish workout': 'finished', 'Discard workout': 'discarded'},
    # '~' = tell the shell but let the prototype handle the tap too.
    'plan-builder.html': {'Apply plan': 'applied', 'Apply changes': '~changed', 'Close': 'back', 'End plan': 'endplan', 'Pause plan': '~paused', 'Resume plan': '~resumed'},
    'progress-simple.html': {},
}

# Per-file additions.
EXTRA = {
    'plan-builder.html': """
  // #view opens the plan you have, as the Your plan overview (Library › your plan).
  if (location.hash === '#view') addEventListener('load', () => { Object.assign(S, { ans: { wk: true, eff: true, focus: true }, priAsk: 'No', actAsk: 'No', page: 'plan', applied: true, editing: false, chat: [], open: -1 }); S.plan = build(); render(); });
""",
    'training-blocks.html': """
  // #progress opens the block's progress screen (the shell's Progress → Block).
  if (location.hash === '#progress') addEventListener('load', () => document.querySelector('[data-a="tab"][data-v="progress"]')?.click());
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


def main(out: pathlib.Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / 'app.html').write_text((HERE / 'app-shell.html').read_text())
    for name, go in GO.items():
        src = (PROTOS / name).read_text()
        snippet = SNIPPET.format(go=json.dumps(go), extra=EXTRA.get(name, ''))
        (out / name).write_text(HEAD + snippet + src)
    print(f'built {len(GO) + 1} files in {out}')


if __name__ == '__main__':
    main(pathlib.Path(sys.argv[1]))
