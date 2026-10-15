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

/** Parsed paths (read-only token lists), or null for a malformed one; the install has a few thousand. */
const parsedPaths = new Map<string, Token[][] | null>();
function parsed(path: string): Token[][] | null {
  let p = parsedPaths.get(path);
  if (p === undefined) {
    try { p = parsePath(path); } catch { p = null; }
    parsedPaths.set(path, p);
  }
  return p;
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
  const groups = parsed(path);
  if (!groups) return false;
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

/**
 * Deep-copies an imported object graph, preserving cycles and shared references but
 * sharing typed arrays (vertex and index data), which arguments never modify. Objects already
 * in `seen` become what it maps them to (applyArguments shares parts of a config that way).
 */
export function cloneGraph<T>(value: T, seen = new Map<unknown, unknown>()): T {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
  const prior = seen.get(value);
  if (prior) return prior as T;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (const v of value) out.push(cloneGraph(v, seen));
    return out as T;
  }
  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const k of Object.keys(value)) out[k] = cloneGraph((value as Record<string, unknown>)[k], seen);
  return out as T;
}

export const hasArguments = (ref: any) => (ref?.arguments?.entries?.length ?? 0) > 0;

/**
 * A model's mesh sets (ModelConfig.MeshSet: bounds, visible meshes and their geometry, the
 * collision mesh's tree) hold nearly all of a model config's objects, and only read-only data.
 */
const MESH_SET = "com.threerings.opengl.model.config.ModelConfig$MeshSet";

/** Every property path a parameter writes (a Choice's through its directs). */
function parameterPaths(p: any, depth = 0): string[] {
  if (!p || depth > 8) return [];
  return [...((p.paths ?? []) as string[]), ...((p.directs ?? []) as any[]).flatMap(d => parameterPaths(d, depth + 1))];
}

/** The existing objects setPath(root, path) would pass through (read-only; nothing is created). */
function pathObjects(root: any, path: string, out: Set<unknown>) {
  const groups = parsed(path);
  if (!groups) return;
  let cur = root;
  for (const group of groups) {
    for (const tok of group) {
      if (cur == null || typeof cur !== "object") return;
      out.add(cur);
      cur = tok.kind === "word" ? cur[fieldName(tok.value)] : tok.kind === "index" ? (Array.isArray(cur) ? cur[tok.value] : undefined)
        : cur.$class === CONFIG_REF ? getArg(cur, tok.value) : undefined;
    }
  }
  if (cur != null && typeof cur === "object") out.add(cur);
}

/** Whether any object in `targets` is reachable from root (outer-instance links aside). */
function reaches(root: unknown, targets: Set<unknown>): boolean {
  const stack = [root], seen = new Set<unknown>();
  while (stack.length) {
    const o = stack.pop();
    if (o === null || typeof o !== "object" || ArrayBuffer.isView(o) || seen.has(o)) continue;
    if (targets.has(o)) return true;
    seen.add(o);
    if (Array.isArray(o)) { for (const v of o) stack.push(v); continue; }
    for (const k of Object.keys(o)) if (k !== "$outer") stack.push((o as Record<string, unknown>)[k]);
  }
  return false;
}

/**
 * The parts of a parameterized config applyArguments shares instead of copying: its own
 * parameter list and its implementation's mesh sets, each unless a parameter path passes
 * through it or reaches into it. No argument writes to those, so a clone that reads the
 * originals reads the same data. Configs from the install are read-only and cached, so this is
 * worked out once per config.
 */
interface Shared { parameters: unknown[] | null; meshSets: unknown[] }
const sharedParts = new WeakMap<object, Shared>();
export function sharedOf(config: any): Shared {
  let s = sharedParts.get(config);
  if (s) return s;
  const onPath = new Set<unknown>();
  for (const p of (config.parameters ?? []) as any[]) for (const path of parameterPaths(p)) pathObjects(config, path, onPath);
  const free = (o: unknown) => !onPath.has(o) && !reaches(o, onPath);
  const parameters = Array.isArray(config.parameters) && free(config.parameters) ? config.parameters as unknown[] : null;
  const meshSets: unknown[] = [];
  const stack: unknown[] = [config.implementation], seen = new Set<unknown>();
  while (stack.length) {
    const o = stack.pop() as any;
    if (o === null || typeof o !== "object" || ArrayBuffer.isView(o) || seen.has(o)) continue;
    seen.add(o);
    if (o.$class === MESH_SET) { if (free(o)) meshSets.push(o); continue; }
    if (Array.isArray(o)) { for (const v of o) stack.push(v); continue; }
    for (const k of Object.keys(o)) if (k !== "$outer") stack.push(o[k]);
  }
  sharedParts.set(config, s = { parameters, meshSets });
  return s;
}

/** Applies every argument in a ConfigReference to a clone of config. */
export function applyArguments(config: any, ref: any): any {
  if (!hasArguments(ref)) return config;
  // the parts no argument can change are shared (copying every variant's geometry and collision
  // tree was most of a scene's load, an accessory's colour choices most of the item list's)
  const seen = new Map<unknown, unknown>();
  if (config !== null && typeof config === "object") {
    const shared = sharedOf(config);
    if (shared.parameters) seen.set(shared.parameters, shared.parameters);
    for (const m of shared.meshSets) seen.set(m, m);
  }
  const clone = cloneGraph(config, seen);
  for (const [k, v] of ref?.arguments?.entries ?? []) applyArgument(clone, String(k), v);
  return clone;
}
