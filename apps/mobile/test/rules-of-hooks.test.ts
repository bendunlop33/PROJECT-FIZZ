import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Rules of Hooks (crash on Start, 27 Oct): a hook called after an early `return` in a component or hook changes the
 * hook count between renders ("Rendered more hooks than during the previous render"), which closed the app on Start.
 * No lint rule covers it here, so every component (`PascalCase`) and hook (`useX`) body is checked: once a top-level
 * statement can return, no later top-level statement may call a hook.
 */
const SRC = join(import.meta.dirname, '../src');

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

function isHookCall(n: ts.Node): boolean {
  if (!ts.isCallExpression(n)) return false;
  const e = n.expression;
  return (ts.isIdentifier(e) && /^use[A-Z]/.test(e.text)) || (ts.isPropertyAccessExpression(e) && /^use[A-Z]/.test(e.name.text) && e.expression.getText() === 'React');
}

function has(node: ts.Node, test: (n: ts.Node) => boolean): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    // Code inside a nested function (a callback, a local function) runs later, not during the render.
    if (found || ts.isFunctionLike(n)) return;
    if (test(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function hooksAfterReturn(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.body !== undefined && ts.isBlock(n.body)) {
      const parent = n.parent as ts.Node & { name?: ts.Node };
      const name = ts.isFunctionDeclaration(n) ? (n.name?.text ?? '') : ts.isVariableDeclaration(parent) ? parent.name.getText() : '';
      if (/^(use[A-Z]|[A-Z])/.test(name)) {
        let returned = false;
        for (const s of n.body.statements) {
          if (returned && has(s, isHookCall)) out.push(`${relative(SRC, file)}:${String(src.getLineAndCharacterOfPosition(s.getStart()).line + 1)} ${name}`);
          if (has(s, ts.isReturnStatement)) returned = true;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

describe('Rules of Hooks', () => {
  it('no component or hook calls a hook after an early return', () => {
    expect(files(SRC).flatMap(hooksAfterReturn)).toEqual([]);
  });

  it('catches the shape that closed the app on Start (27 Oct)', () => {
    const bad = 'function Screen() {\n  const [a] = useState(0);\n  if (a === 0) return null;\n  useEffect(() => {}, []);\n  return null;\n}\n';
    const src = ts.createSourceFile('x.tsx', bad, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const fn = src.statements[0] as ts.FunctionDeclaration;
    const stmts = fn.body?.statements ?? ts.factory.createNodeArray();
    const late = stmts.findIndex((s, i) => i > 1 && has(s, isHookCall));
    expect(late).toBe(2);
  });
});
