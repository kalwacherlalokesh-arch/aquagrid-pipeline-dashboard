export type Condition = 'normal' | 'warning' | 'leak' | 'closed';
export type Node = { id: string; name: string; x: number; y: number; sensor: string | null; pressure: number; flow: number; condition: Condition; kind: 'junction' | 'tank' | 'pump' | 'valve' | 'station' };
export type Pipe = { id: string; from: string; to: string; distance: number; flow: number; pressure: number; condition: Condition };
export type Frame = { current: string | null; visited: string[]; frontier: string[]; explored: string[]; activeEdge?: string; distances?: Record<string, number>; note: string; finalPath?: string[] };

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXY'.split('');
const leaks = ['D', 'K', 'R', 'W'];
const warnings = ['F', 'N', 'T'];
export const nodes: Node[] = letters.map((id, i) => ({
  id, name: ['North Reservoir', 'Hill Junction', 'Central Pump', 'East Junction', 'Market Valve', 'West Junction', 'School Junction', 'Civic Center', 'Garden Junction', 'East Tank', 'Canal Junction', 'South Pump', 'Midtown Junction', 'Hospital Junction', 'Industrial Valve', 'Park Junction', 'Station Junction', 'Riverside Junction', 'Depot Junction', 'South Valve', 'Maintenance M1', 'Southwest Junction', 'Lakeside Junction', 'Coastal Junction', 'Maintenance M2'][i] ?? id,
  x: 80 + (i % 5) * 144 + (Math.floor(i / 5) % 2) * 18,
  y: 60 + Math.floor(i / 5) * 105,
  sensor: i < 20 ? `S-${String(i + 1).padStart(2, '0')}` : null,
  pressure: leaks.includes(id) ? 2.1 + (i % 3) * .2 : warnings.includes(id) ? 3.3 : 4.3 + (i % 5) * .12,
  flow: leaks.includes(id) ? 37 + i : 80 + (i * 7) % 38,
  condition: leaks.includes(id) ? 'leak' : warnings.includes(id) ? 'warning' : 'normal',
  kind: id === 'A' || id === 'J' ? 'tank' : id === 'C' || id === 'L' ? 'pump' : id === 'E' || id === 'O' || id === 'T' ? 'valve' : id === 'U' || id === 'Y' ? 'station' : 'junction',
}));
const connections: [string, string][] = [];
for (let row = 0; row < 5; row++) for (let col = 0; col < 4; col++) connections.push([letters[row * 5 + col] ?? '', letters[row * 5 + col + 1] ?? '']);
for (let row = 0; row < 4; row++) for (const col of [0, 2, 4]) connections.push([letters[row * 5 + col] ?? '', letters[(row + 1) * 5 + col] ?? '']);
export const pipes: Pipe[] = connections.map(([from, to], i) => ({
  id: `P-${101 + i}`, from, to,
  distance: Number((.7 + (i * 7 % 11) * .18).toFixed(1)),
  flow: 68 + (i * 11) % 47,
  pressure: Number((3.5 + (i % 8) * .17).toFixed(1)),
  condition: [3, 9, 17, 27].includes(i) ? 'leak' : [6, 14, 23, 30].includes(i) ? 'warning' : [11, 25].includes(i) ? 'closed' : 'normal',
}));
export const nodeById = Object.fromEntries(nodes.map(n => [n.id, n])) as Record<string, Node | undefined>;
export const adjacency = Object.fromEntries(nodes.map(n => [n.id, [] as { node: string; pipe: Pipe }[]])) as Record<string, { node: string; pipe: Pipe }[] | undefined>;
for (const pipe of pipes) if (pipe.condition !== 'closed') {
  adjacency[pipe.from]?.push({ node: pipe.to, pipe });
  adjacency[pipe.to]?.push({ node: pipe.from, pipe });
}
const snapshot = (current: string | null, visited: string[], frontier: string[], explored: string[], note: string, extra: Partial<Frame> = {}): Frame => ({ current, visited: [...visited], frontier: [...frontier], explored: [...explored], note, ...extra });

export function bfs(start: string, depth = Infinity): Frame[] {
  const seen = new Set([start]); const queue = [{ id: start, level: 0 }]; const visited: string[] = []; const explored: string[] = [];
  const frames = [snapshot(null, [], [start], [], `Queued ${start}`)];
  while (queue.length) {
    const { id, level } = queue.shift() ?? { id: start, level: 0 }; visited.push(id);
    frames.push(snapshot(id, visited, queue.map(q => q.id), explored, `Visiting ${id} · level ${level}`));
    if (level < depth) for (const neighbor of (adjacency[id] ?? [])) if (!seen.has(neighbor.node)) {
      seen.add(neighbor.node); queue.push({ id: neighbor.node, level: level + 1 }); explored.push(neighbor.pipe.id);
      frames.push(snapshot(id, visited, queue.map(q => q.id), explored, `Discovered ${neighbor.node} from ${id}`, { activeEdge: neighbor.pipe.id }));
    }
  }
  return frames;
}
export function dfs(start: string): Frame[] {
  const seen = new Set<string>(); const visited: string[] = []; const explored: string[] = []; const stack: { id: string; edge?: string }[] = [{ id: start }];
  const frames = [snapshot(null, [], [start], [], `Ready to inspect ${start}`)];
  while (stack.length) {
    const { id, edge } = stack.pop() ?? { id: start };
    if (seen.has(id)) continue;
    seen.add(id); visited.push(id); if (edge) explored.push(edge);
    frames.push(snapshot(id, visited, stack.map(s => s.id), explored, `Inspecting ${id}`, edge ? { activeEdge: edge } : {}));
    for (const next of [...(adjacency[id] ?? [])].reverse()) if (!seen.has(next.node)) stack.push({ id: next.node, edge: next.pipe.id });
    frames.push(snapshot(id, visited, stack.map(s => s.id), explored, `Branch from ${id} · ${stack.length} pending`));
  }
  return frames;
}
export function dijkstra(start: string, end: string): { frames: Frame[]; path: string[]; distance: number } {
  const distances: Record<string, number> = Object.fromEntries(nodes.map(n => [n.id, Infinity]));
  const previous: Record<string, string | null> = {}; const visited: string[] = []; const explored: string[] = []; const settled = new Set<string>();
  distances[start] = 0;
  const frames = [snapshot(null, [], [start], [], `Starting at ${start}`, { distances: { ...distances } })];
  while (settled.size < nodes.length) {
    const current = nodes.filter(n => !settled.has(n.id)).sort((a, b) => (distances[a.id] ?? Infinity) - (distances[b.id] ?? Infinity))[0]?.id;
    if (!current || (distances[current] ?? Infinity) === Infinity) break;
    settled.add(current); visited.push(current);
    frames.push(snapshot(current, visited, [], explored, `Settled ${current} at ${(distances[current] ?? Infinity).toFixed(1)} km`, { distances: { ...distances } }));
    if (current === end) break;
    for (const { node, pipe } of (adjacency[current] ?? [])) {
      if (settled.has(node)) continue;
      const candidate = (distances[current] ?? Infinity) + pipe.distance;
      if (candidate < (distances[node] ?? Infinity)) {
        distances[node] = candidate; previous[node] = current; explored.push(pipe.id);
        frames.push(snapshot(current, visited, Object.keys(distances).filter(k => (distances[k] ?? Infinity) < Infinity && !settled.has(k)), explored, `Updated ${node} to ${candidate.toFixed(1)} km`, { activeEdge: pipe.id, distances: { ...distances } }));
      }
    }
  }
  const path: string[] = [];
  if ((distances[end] ?? Infinity) < Infinity) { let at: string | null = end; while (at) { path.unshift(at); at = previous[at] ?? null; } }
  frames.push(snapshot(null, visited, [], explored, path.length ? `Shortest route: ${path.join(' → ')}` : 'No route available', { finalPath: path, distances: { ...distances } }));
  return { frames, path, distance: distances[end] ?? Infinity };
}
export function pathPipeIds(path: string[]) { return pipes.filter(p => path.some((n, i) => i < path.length - 1 && ((p.from === n && p.to === path[i + 1]) || (p.to === n && p.from === path[i + 1])))).map(p => p.id); }
