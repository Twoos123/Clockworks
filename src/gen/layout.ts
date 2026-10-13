// Floor layouts for generated levels: rooms joined by corridors three cells wide, like the
// Clockworks' arenas and halls. The first room is the start, the farthest (by corridor steps)
// holds the exit; the rest hold encounters.

import { State } from "./autotile";

export interface Room { x: number; y: number; w: number; h: number }
export interface Layout {
  cells: Map<string, State>;
  rooms: Room[];
  /** Index of the start and exit rooms. */
  start: number;
  exit: number;
}

/** A small seeded random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const center = (r: Room): [number, number] => [Math.floor(r.x + r.w / 2), Math.floor(r.y + r.h / 2)];

export interface LayoutOptions {
  rooms?: number;
  deepEdges?: boolean;
  /** Sizes of the first rooms, in order (the rest are random): an arena floor's one big hall. */
  sizes?: [number, number][];
  /** Each room grows off the one before it, so the rooms form a chain from the start. */
  chain?: boolean;
}

export function generateLayout(rand: () => number, opts: LayoutOptions = {}): Layout {
  const count = opts.rooms ?? 6 + Math.floor(rand() * 3);
  const rooms: Room[] = [];
  const overlaps = (a: Room, b: Room) => a.x - 4 < b.x + b.w && b.x - 4 < a.x + a.w && a.y - 4 < b.y + b.h && b.y - 4 < a.y + a.h;
  // rooms grow outward from the first: each new one sits off a random earlier one
  for (let tries = 0; rooms.length < count && tries < 400; tries++) {
    const size = opts.sizes?.[rooms.length];
    const w = size?.[0] ?? 7 + Math.floor(rand() * 6), h = size?.[1] ?? 7 + Math.floor(rand() * 6);
    let r: Room;
    if (!rooms.length) r = { x: 0, y: 0, w, h };
    else {
      const from = opts.chain ? rooms[rooms.length - 1] : rooms[Math.floor(rand() * rooms.length)];
      const dir = Math.floor(rand() * 4), gap = 4 + Math.floor(rand() * 5);
      const [cx, cy] = center(from);
      r = dir === 0 ? { x: from.x + from.w + gap, y: cy - Math.floor(h / 2) + Math.floor((rand() - 0.5) * 4), w, h }
        : dir === 1 ? { x: from.x - gap - w, y: cy - Math.floor(h / 2) + Math.floor((rand() - 0.5) * 4), w, h }
        : dir === 2 ? { x: cx - Math.floor(w / 2) + Math.floor((rand() - 0.5) * 4), y: from.y + from.h + gap, w, h }
        : { x: cx - Math.floor(w / 2) + Math.floor((rand() - 0.5) * 4), y: from.y - gap - h, w, h };
    }
    if (rooms.some(o => overlaps(o, r))) continue;
    rooms.push(r);
  }
  const floor = new Set<string>();
  const put = (x: number, y: number) => floor.add(x + "," + y);
  for (const r of rooms) for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) put(x, y);
  // join each room to its nearest earlier room with an L-shaped corridor three cells wide
  const adj: number[][] = rooms.map(() => []);
  for (let i = 1; i < rooms.length; i++) {
    let best = 0, bd = Infinity;
    for (let j = 0; j < i; j++) {
      const [ax, ay] = center(rooms[i]), [bx, by] = center(rooms[j]);
      const d = Math.abs(ax - bx) + Math.abs(ay - by);
      if (d < bd) { bd = d; best = j; }
    }
    adj[i].push(best); adj[best].push(i);
    const [ax, ay] = center(rooms[i]), [bx, by] = center(rooms[best]);
    const horizontalFirst = rand() < 0.5;
    const corner: [number, number] = horizontalFirst ? [bx, ay] : [ax, by];
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      for (let x = Math.min(x0, x1) - 1; x <= Math.max(x0, x1) + 1; x++)
        for (let y = Math.min(y0, y1) - 1; y <= Math.max(y0, y1) + 1; y++) put(x, y);
    };
    line(ax, ay, corner[0], corner[1]);
    line(corner[0], corner[1], bx, by);
  }
  // the exit is the room farthest from the start along the corridors
  const dist = rooms.map(() => Infinity);
  dist[0] = 0;
  const queue = [0];
  while (queue.length) {
    const i = queue.shift()!;
    for (const j of adj[i]) if (dist[j] === Infinity) { dist[j] = dist[i] + 1; queue.push(j); }
  }
  let exit = 0;
  dist.forEach((d, i) => { if (d !== Infinity && d > dist[exit]) exit = i; });

  // non-floor rings around the floor: one cell, or two where the theme's edges run deep
  const cells = new Map<string, State>();
  for (const k of floor) cells.set(k, State.Floor);
  const ring = (from: Iterable<string>) => {
    const added: string[] = [];
    for (const k of from) {
      const [x, y] = k.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const n = (x + dx) + "," + (y + dy);
        if (!cells.has(n)) { cells.set(n, State.Other); added.push(n); }
      }
    }
    return added;
  };
  const first = ring(floor);
  if (opts.deepEdges) ring(first);
  return { cells, rooms, start: 0, exit };
}
