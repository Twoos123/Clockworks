// Clyde's parameterized-config system, reimplemented over imported object graphs.
//
// A ParameterizedConfig declares named parameters. A Direct parameter writes its argument
// to one or more property paths ("implementation.techniques[0].enqueuer.passes[0]
// .texture_state.units[0].texture"); a Choice parameter maps an option name to a set of
// arguments for its own direct parameters. Path segments are field names in lower-case
// underscore form, followed by optional [index] or ["argument"] selectors, where the
// latter addresses an argument of a nested ConfigReference (see Clyde's PathProperty).

import type { JMap } from "../export/BinaryImport";

export const CONFIG_REF = "com.threerings.config.ConfigReference";
const ARGUMENT_MAP = "com.threerings.config.ArgumentMap";

type Token = { kind: "word"; value: string } | { kind: "index"; value: number } | { kind: "arg"; value: string };

export function parsePath(path: string): Token[][] {
  // returns one token group per dotted segment: a field name plus any selectors
  const out: Token[][] = [];
  let i = 0;
  while (i < path.length) {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(path.substring(i));
    if (!m) throw new Error(`Bad path "${path}" at ${i}`);
    const group: Token[] = [{ kind: "word", value: m[0] }];
    i += m[0].length;
    while (path[i] === "[") {
      const close = path[i + 1] === '"' ? path.indexOf('"]', i + 2) + 1 : path.indexOf("]", i);
      const inner = path.substring(i + 1, close);
      if (inner.startsWith('"')) group.push({ kind: "arg", value: inner.slice(1, -1).replace(/\\"/g, '"') });
      else group.push({ kind: "index", value: parseInt(inner, 10) });
      i = close + 1;
    }
    out.push(group);
    if (path[i] === ".") i++;
  }
  return out;
}

/** "texture_state" -> "textureState" (the inverse of StringUtil.unStudlyName). */
export const fieldName = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export function argumentsOf(ref: any): JMap {
  if (!ref.arguments) ref.arguments = { $map: ARGUMENT_MAP, entries: [] };
  return ref.arguments as JMap;
}

export function getArg(ref: any, name: string): unknown {
  return (ref?.arguments?.entries as [unknown, unknown][] | undefined)?.find(([k]) => k === name)?.[1];
}

export function setArg(ref: any, name: string, value: unknown) {
  const map = argumentsOf(ref);
  const e = map.entries.find(([k]) => k === name);
  if (e) e[1] = value; else map.entries.push([name, value]);
}

/** Writes value at path within root, creating missing intermediate objects. */
export function setPath(root: any, path: string, value: unknown): boolean {
  let groups: Token[][];
  try { groups = parsePath(path); } catch { return false; }
  let cur = root;
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const lastGroup = gi === groups.length - 1;
    for (let ti = 0; ti < group.length; ti++) {
      const tok = group[ti];
      const last = lastGroup && ti === group.length - 1;
      if (cur == null || typeof cur !== "object") return false;
      if (tok.kind === "word") {
        const f = fieldName(tok.value);
        if (last) { cur[f] = value; return true; }
        if (cur[f] == null) {
          // exported objects omit default-valued fields; create a placeholder
          const nextIsIndex = group[ti + 1]?.kind === "index";
          cur[f] = nextIsIndex ? [] : {};
        }
        cur = cur[f];
      } else if (tok.kind === "index") {
        if (!Array.isArray(cur)) return false;
        if (last) { cur[tok.value] = value; return true; }
        cur[tok.value] ??= {};
        cur = cur[tok.value];
      } else {
        if (cur.$class !== CONFIG_REF) return false;
        if (last) { setArg(cur, tok.value, value); return true; }
        let next = getArg(cur, tok.value);
        if (next == null) { next = {}; setArg(cur, tok.value, next); }
        cur = next;
      }
    }
  }
  return false;
}

/** Applies one argument to a (cloned) parameterized config. */
export function applyArgument(config: any, name: string, value: unknown) {
  const param = (config.parameters as any[] | undefined)?.find(p => p.name === name);
  if (!param) return;
  applyParameter(config, param, value);
}

function applyParameter(config: any, param: any, value: unknown) {
  if (param.$class.endsWith("Parameter$Choice")) {
    const option = (param.options as any[] | undefined)?.find(o => o.name === value);
    if (!option) return;
    for (const [k, v] of option.arguments?.entries ?? []) {
      const direct = (param.directs as any[] | undefined)?.find(d => d.name === k);
      if (direct) applyParameter(config, direct, v);
    }
    return;
  }
  for (const path of param.paths ?? []) setPath(config, path, value);
}

/** Applies every argument in a ConfigReference to a clone of config. */
export function applyArguments(config: any, ref: any): any {
  const clone = structuredClone(config);
  for (const [k, v] of ref?.arguments?.entries ?? []) applyArgument(clone, String(k), v);
  return clone;
}
