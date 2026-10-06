import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Activity, AlertCircle, ArrowDownRight, ArrowRight, Bell, Check, ChevronDown, CircleHelp, Clock3, Droplets, Gauge, GitBranch, Layers3, LocateFixed, MapPin, Maximize2, Menu, Moon, Pause, Play, RotateCcw, Route as RouteIcon, Search, ShieldCheck, SlidersHorizontal, Sun, Waves, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { adjacency, bfs, dfs, dijkstra, nodeById, nodes, pathPipeIds, pipes, type Condition, type Frame, type Node, type Pipe } from '@/lib/pipeline';

export const Route = createFileRoute('/')({
  head: () => ({ meta: [
    { title: 'AquaGrid — Smart Water Pipeline Monitoring' },
    { name: 'description', content: 'Explore a simulated water pipeline network with live graph visualizations, BFS, DFS, and shortest maintenance routes.' },
    { property: 'og:title', content: 'AquaGrid — Smart Water Pipeline Monitoring' },
    { property: 'og:description', content: 'An interactive educational pipeline monitoring dashboard powered by graph algorithms.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Dashboard,
});

type Mode = 'overview' | 'bfs' | 'dfs' | 'shortest' | 'leak-search' | 'inspection' | 'emergency';
type Selection = { kind: 'node'; item: Node } | { kind: 'pipe'; item: Pipe };
const nav = [
  { id: 'overview', label: 'Overview', icon: Layers3 },
  { id: 'bfs', label: 'BFS Explorer', icon: Search },
  { id: 'dfs', label: 'DFS Inspection', icon: GitBranch },
  { id: 'shortest', label: 'Shortest Path', icon: RouteIcon },
  { id: 'leak-search', label: 'Leak Search', icon: Droplets },
  { id: 'emergency', label: 'Emergency Route', icon: LocateFixed },
] as const;
const alerts = [
  { title: 'Leak detected near Node D', detail: 'Pipeline P-104 · 2.1 bar', node: 'D', severity: 'critical' },
  { title: 'Leak detected near Node K', detail: 'Sector 03 · pressure anomaly', node: 'K', severity: 'critical' },
  { title: 'Pressure drop at Node F', detail: 'Sensor S-06 · 3.3 bar', node: 'F', severity: 'warning' },
  { title: 'Sensor S-12 battery low', detail: 'Node L · maintenance needed', node: 'L', severity: 'info' },
];
const series = Array.from({ length: 12 }, (_, i) => ({ time: `${String(i * 2).padStart(2, '0')}:00`, flow: 65 + Math.round(18 * Math.sin(i * .55) + i * 1.2), pressure: 3.9 + Math.sin(i * .55) * .4, leaks: i % 4 === 2 ? 2 : i % 5 === 0 ? 1 : 0, loss: 530 + i * 24 + Math.round(80 * Math.sin(i)), failures: i % 4 === 0 ? 2 : i % 3 === 0 ? 1 : 0, sensors: 15 + i % 5 }));
const chartOptions = ['Water flow', 'Pressure', 'Leak frequency', 'Water loss', 'Pipeline failures', 'Sensor activity'] as const;
const chartKey: Record<string, string> = { 'Water flow': 'flow', Pressure: 'pressure', 'Leak frequency': 'leaks', 'Water loss': 'loss', 'Pipeline failures': 'failures', 'Sensor activity': 'sensors' };
const conditions: Record<Condition, string> = { normal: 'Normal', warning: 'Warning', leak: 'Leaking', closed: 'Closed' };
const descriptions: Record<Mode, string> = {
  overview: 'A real-time view of your water distribution network.',
  bfs: 'Explore nearby junctions one level at a time.',
  dfs: 'Inspect connected pipeline regions branch by branch.',
  shortest: 'Find the minimum-distance route between two nodes.',
  'leak-search': 'Find active sensors near a suspected leak.',
  inspection: 'Find every reachable node from a selected junction.',
  emergency: 'Find the quickest route from a maintenance station to a leak.',
};

function Dashboard() {
  const [mode, setMode] = useState<Mode>('overview');
  const [start, setStart] = useState('D');
  const [destination, setDestination] = useState('H');
  const [station, setStation] = useState('U');
  const [depth, setDepth] = useState(2);
  const [speed, setSpeed] = useState(55);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [chart, setChart] = useState<string>('Water flow');
  const [period, setPeriod] = useState('Daily');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(window.localStorage.getItem('aquagrid-theme') === 'dark'); }, []);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); window.localStorage.setItem('aquagrid-theme', dark ? 'dark' : 'light'); }, [dark]);
  const graphRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState(d3.zoomIdentity);
  const frame = frames[step];
  const final = frames.at(-1);
  const finished = frames.length > 0 && step === frames.length - 1;
  const path = final?.finalPath ?? [];
  const routeDistance = pathPipeIds(path).reduce((sum, id) => sum + (pipes.find(p => p.id === id)?.distance ?? 0), 0);
  const currentTitle = mode === 'overview' ? 'Network overview' : ({ bfs: 'BFS explorer', dfs: 'DFS inspection', shortest: 'Shortest path finder', 'leak-search': 'Nearby leak sensors', inspection: 'Connected network', emergency: 'Emergency technician route' } as Record<Mode, string>)[mode];

  useEffect(() => {
    const svg = graphRef.current;
    if (!svg) return;
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([.65, 2.5]).on('zoom', event => setTransform(event.transform));
    zoomRef.current = zoom;
    d3.select(svg).call(zoom).on('dblclick.zoom', null);
    return () => { d3.select(svg).on('.zoom', null); };
  }, []);
  useEffect(() => {
    if (!playing || step >= frames.length - 1) { if (playing && step >= frames.length - 1) setPlaying(false); return; }
    const timer = window.setTimeout(() => setStep(s => s + 1), 1050 - speed * 9);
    return () => window.clearTimeout(timer);
  }, [playing, step, frames, speed]);
  function switchMode(next: Mode) { setMode(next); setFrames([]); setStep(0); setPlaying(false); setSidebarOpen(false); }
  function run() {
    let result: Frame[];
    if (mode === 'bfs' || mode === 'leak-search') result = bfs(start, mode === 'leak-search' ? depth : Infinity);
    else if (mode === 'dfs' || mode === 'inspection') result = dfs(start);
    else result = dijkstra(mode === 'emergency' ? station : start, mode === 'emergency' ? start : destination).frames;
    setFrames(result); setStep(0); setPlaying(true); setSelection(null);
  }
  function reset() { setFrames([]); setStep(0); setPlaying(false); }
  function zoomBy(factor: number) { if (graphRef.current && zoomRef.current) d3.select(graphRef.current).transition().duration(250).call(zoomRef.current.scaleBy, factor); }
  function centerNode(id: string) {
    const node = nodeById[id]; if (!node) return;
    setSelection({ kind: 'node', item: node });
    graphRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (graphRef.current && zoomRef.current) d3.select(graphRef.current).transition().duration(550).call(zoomRef.current.transform, d3.zoomIdentity.translate(380 - node.x * 1.25, 280 - node.y * 1.25).scale(1.25));
  }
  const nearbySensors = mode === 'leak-search' && finished ? (final?.visited ?? []).map(id => nodeById[id]).filter((n): n is Node => Boolean(n?.sensor)) : [];
  const selectedNode = selection?.kind === 'node' ? selection.item : null;
  const selectedPipe = selection?.kind === 'pipe' ? selection.item : null;
  const totalVisited = frame?.visited.length ?? 0;
  const chartData = useMemo(() => period === 'Daily' ? series : period === 'Weekly' ? series.map((item, i) => ({ ...item, time: `Day ${i + 1}` })) : series.map((item, i) => ({ ...item, time: `W${i + 1}` })), [period]);

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Waves size={23} strokeWidth={2.5} /></span><div><strong>AquaGrid</strong><small>INTELLIGENT WATER SYSTEMS</small></div><Button variant="ghost" size="icon" className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X /></Button></div>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Dashboard navigation">{nav.map(item => <Button key={item.id} variant="ghost" className={`nav-item ${mode === item.id ? 'active' : ''}`} onClick={() => switchMode(item.id)}><item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{item.id === 'leak-search' && <span className="nav-count">4</span>}</Button>)}</nav>
      <div className="sidebar-section-label tools-label">TOOLS & INSIGHTS</div>
      <nav className="side-nav" aria-label="Additional tools"><Button variant="ghost" className={`nav-item ${mode === 'inspection' ? 'active' : ''}`} onClick={() => switchMode('inspection')}><GitBranch size={18} /><span>Network inspection</span></Button><Button variant="ghost" className="nav-item" onClick={() => document.getElementById('analytics')?.scrollIntoView({ behavior: 'smooth' })}><Activity size={18} /><span>Analytics</span></Button><Button variant="ghost" className="nav-item" onClick={() => document.getElementById('alerts')?.scrollIntoView({ behavior: 'smooth' })}><Bell size={18} /><span>Alerts</span><span className="nav-count">4</span></Button></nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-info"><div className="sidebar-info-top"><span className="online-dot" /> SYSTEM OPERATIONAL</div><strong>Network connected</strong><p>25 nodes · 32 pipelines monitored</p><div className="sidebar-progress"><span /></div><small>91% network health</small></div>
      <div className="sidebar-footer"><span className="avatar">AG</span><div><strong>AquaGrid Demo</strong><small>Educational workspace</small></div><ChevronDown size={16} /></div>
    </aside>
    {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
    <main className="main-area">
      <header className="topbar"><div className="top-left"><Button variant="ghost" size="icon" className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu /></Button><span className="breadcrumb">Workspace</span><span className="breadcrumb-slash">/</span><span className="breadcrumb-current">{currentTitle}</span></div><div className="top-actions"><span className="demo-pill"><span className="demo-dot" /> Demo / Simulated Data</span><span className="top-divider" /><Button variant="ghost" size="icon" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"} onClick={() => setDark(!dark)} className="theme-button">{dark ? <Sun size={18} /> : <Moon size={18} />}</Button><Button variant="ghost" size="icon" aria-label="View alerts" onClick={() => document.getElementById('alerts')?.scrollIntoView({ behavior: 'smooth' })} className="notification-button"><Bell size={19} /><i /></Button><span className="top-avatar">AG</span></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> SMART WATER MONITORING PLATFORM</div><h1>{currentTitle}</h1><p>{descriptions[mode]}</p></div><div className="heading-right"><span className="live-status"><span /> All systems operational</span><span className="update-time">Last updated just now</span></div></div>
        <section className="metrics-grid" aria-label="Network metrics">
          <Metric icon={Layers3} label="Total nodes" value="25" change="Across 5 sectors" tone="blue" />
          <Metric icon={GitBranch} label="Total pipelines" value="32" change="30 operational" tone="teal" />
          <Metric icon={Activity} label="Active sensors" value="20" change="Monitoring live" tone="violet" />
          <Metric icon={AlertCircle} label="Detected leaks" value="04" change="Requires attention" tone="red" />
          <Metric icon={Droplets} label="Water loss" value="8,450" suffix="L/day" change="Estimated daily" tone="amber" />
          <Metric icon={ShieldCheck} label="Network health" value="91" suffix="%" change="Good condition" tone="green" />
        </section>
        <div className="primary-grid">
          <section className="panel network-panel">
            <div className="panel-heading"><div><div className="section-kicker">NETWORK VISUALIZATION</div><h2>Pipeline network <span className="heading-badge">LIVE VIEW</span></h2><p>Explore junctions, sensors, and pipeline connections</p></div><div className="panel-actions"><span className="network-count"><span /> 25 NODES <span className="count-separator">·</span> 32 PIPES</span><Button variant="outline" size="icon" onClick={() => { if (graphRef.current && zoomRef.current) d3.select(graphRef.current).transition().duration(350).call(zoomRef.current.transform, d3.zoomIdentity); }} aria-label="Reset map view" title="Reset map view"><Maximize2 size={16} /></Button></div></div>
            <div className="graph-wrap">
              <div className="graph-grid" />
              <div className="graph-label"><span className="graph-label-dot" /> WATER DISTRIBUTION NETWORK <span>·</span> SECTOR MAP</div>
              <svg ref={graphRef} className="network-svg" viewBox="0 0 760 580" role="img" aria-label="Interactive water pipeline graph with 25 nodes and 32 pipelines">
                <g transform={transform.toString()}>
                  {pipes.map(pipe => {
                    const a = nodeById[pipe.from], b = nodeById[pipe.to];
                    if (!a || !b) return null;
                    const pathIds = frame?.finalPath ? pathPipeIds(frame.finalPath) : [];
                    const onPath = pathIds.includes(pipe.id), explored = frame?.explored.includes(pipe.id), active = frame?.activeEdge === pipe.id;
                    return <g key={pipe.id} className="edge-group" onClick={e => { e.stopPropagation(); setSelection({ kind: 'pipe', item: pipe }); }}>
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="edge-hit" />
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`edge edge-${pipe.condition} ${explored ? 'edge-explored' : ''} ${active ? 'edge-active' : ''} ${onPath ? 'edge-path' : ''}`} />
                    </g>;
                  })}
                  {nodes.map(node => {
                    const visited = frame?.visited.includes(node.id), queued = frame?.frontier.includes(node.id), active = frame?.current === node.id, onPath = frame?.finalPath?.includes(node.id), selected = selectedNode?.id === node.id;
                    return <g key={node.id} className={`graph-node node-${node.condition} ${visited ? 'node-visited' : ''} ${queued ? 'node-queued' : ''} ${active ? 'node-current' : ''} ${onPath ? 'node-path' : ''} ${selected ? 'node-selected' : ''}`} transform={`translate(${node.x},${node.y})`} onClick={e => { e.stopPropagation(); setSelection({ kind: 'node', item: node }); }} role="button" tabIndex={0} aria-label={`Node ${node.id}, ${node.name}, ${node.condition}`} onKeyDown={e => { if (e.key === 'Enter') setSelection({ kind: 'node', item: node }); }}>
                      <circle className="node-halo" r="24" /><circle className="node-ring" r="17" /><circle className="node-core" r="12.5" /><text className="node-letter" textAnchor="middle" dominantBaseline="central">{node.id}</text><text className="node-label" textAnchor="middle" y="35">{node.kind === 'station' ? `MAINT. ${node.id === 'U' ? 'M1' : 'M2'}` : node.name.toUpperCase()}</text>
                      {node.condition !== 'normal' && <circle className="node-indicator" cx="14" cy="-14" r="5" />}
                    </g>;
                  })}
                </g>
              </svg>
              <div className="map-controls"><Button variant="outline" size="icon" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in"><ZoomIn size={17} /></Button><Button variant="outline" size="icon" onClick={() => zoomBy(.8)} aria-label="Zoom out" title="Zoom out"><ZoomOut size={17} /></Button></div>
              {(selection || frame) && <div className="graph-detail"><Button variant="ghost" size="icon" className="detail-close" aria-label="Close details" onClick={() => setSelection(null)}><X size={15} /></Button>{selection ? <><span className="detail-kicker">{selection.kind === 'node' ? 'NODE DETAILS' : 'PIPELINE DETAILS'}</span><strong>{selectedNode ? `Node ${selectedNode.id} · ${selectedNode.name}` : `${selectedPipe?.id} · ${selectedPipe?.from} → ${selectedPipe?.to}`}</strong><div className="detail-fields"><span>Condition <b className={`status-${selection.item.condition}`}>{conditions[selection.item.condition]}</b></span>{selectedNode ? <><span>Sensor <b>{selectedNode.sensor ?? 'Not installed'}</b></span><span>Pressure <b>{selectedNode.pressure.toFixed(1)} bar</b></span><span>Flow rate <b>{selectedNode.flow} L/min</b></span><span>Type <b>{selectedNode.kind}</b></span></> : <><span>Distance <b>{selectedPipe?.distance} km</b></span><span>Pressure <b>{selectedPipe?.pressure} bar</b></span><span>Flow rate <b>{selectedPipe?.flow} L/min</b></span></>}</div></> : <><span className="detail-kicker">ALGORITHM STEP {step + 1} / {frames.length}</span><strong>{frame?.note}</strong><div className="detail-fields"><span>Visited <b>{frame?.visited.length}</b></span><span>Frontier <b>{frame?.frontier.length}</b></span></div></>}</div>}
            </div>
            <div className="graph-footer"><div className="legend"><span><i className="legend-normal" /> Normal</span><span><i className="legend-warning" /> Warning</span><span><i className="legend-leak" /> Leak detected</span><span><i className="legend-closed" /> Closed</span></div><span className="drag-hint">Drag to pan · Scroll to zoom · Select to inspect</span></div>
          </section>
          <div className="right-stack">
            <section className="panel control-panel"><div className="panel-heading compact"><div><div className="section-kicker">GRAPH ALGORITHMS</div><h2>Algorithm control</h2></div><span className="mini-icon"><SlidersHorizontal size={17} /></span></div>
              <div className="control-content"><label className="field-label" htmlFor="algorithm">Algorithm</label><div className="select-wrap"><select id="algorithm" value={mode === 'overview' ? 'bfs' : mode === 'leak-search' || mode === 'inspection' || mode === 'emergency' ? mode : mode} onChange={e => switchMode(e.target.value as Mode)}><option value="bfs">Breadth-first search (BFS)</option><option value="dfs">Depth-first search (DFS)</option><option value="shortest">Dijkstra shortest path</option><option value="leak-search">Search nearby leak sensors</option><option value="inspection">Inspect connected network</option><option value="emergency">Emergency technician route</option></select><ChevronDown size={15} /></div>
                {mode === 'emergency' && <><label className="field-label" htmlFor="station">Maintenance station</label><div className="select-wrap"><select id="station" value={station} onChange={e => setStation(e.target.value)}><option value="U">M1 · Node U</option><option value="Y">M2 · Node Y</option></select><ChevronDown size={15} /></div></>}
                <label className="field-label" htmlFor="start">{mode === 'emergency' ? 'Leak location' : mode === 'leak-search' ? 'Suspected leak node' : 'Start node'}</label><div className="select-wrap"><select id="start" value={start} onChange={e => setStart(e.target.value)}>{nodes.map(n => <option key={n.id} value={n.id}>Node {n.id} · {n.name}</option>)}</select><ChevronDown size={15} /></div>
                {mode === 'shortest' && <><label className="field-label" htmlFor="destination">Destination</label><div className="select-wrap"><select id="destination" value={destination} onChange={e => setDestination(e.target.value)}>{nodes.map(n => <option key={n.id} value={n.id}>Node {n.id} · {n.name}</option>)}</select><ChevronDown size={15} /></div></>}
                {mode === 'leak-search' && <><div className="range-head"><label className="field-label" htmlFor="depth">BFS search depth</label><span>{depth} levels</span></div><input id="depth" type="range" min="1" max="5" value={depth} onChange={e => setDepth(Number(e.target.value))} /></>}
                <div className="range-head"><label className="field-label" htmlFor="speed">Animation speed</label><span>{speed}%</span></div><input id="speed" type="range" min="10" max="100" value={speed} onChange={e => setSpeed(Number(e.target.value))} />
                <Button className="run-button" onClick={run}><Play size={15} fill="currentColor" /> {mode === 'leak-search' ? 'SEARCH SENSORS' : mode === 'emergency' ? 'FIND EMERGENCY ROUTE' : mode === 'inspection' ? 'INSPECT NETWORK' : mode === 'shortest' ? 'FIND SHORTEST PATH' : `RUN ${mode === 'dfs' ? 'DFS' : 'BFS'}` } <ArrowRight size={16} /></Button>
                {frames.length > 0 && <div className="playback"><Button variant="outline" size="sm" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pause' : 'Resume'}</Button><Button variant="outline" size="sm" onClick={reset}><RotateCcw size={14} /> Reset</Button><span>{step + 1}/{frames.length}</span></div>}
              </div>
            </section>
            <section className="panel result-panel"><div className="panel-heading compact"><div><div className="section-kicker">EXECUTION TRACE</div><h2>Algorithm output</h2></div><span className="mini-icon"><Activity size={17} /></span></div>
              {frame ? <div className="result-content"><div className="result-state"><span className={`result-dot ${finished ? 'complete' : ''}`} /> {finished ? 'Execution complete' : playing ? 'Running algorithm' : 'Paused'}</div><div className="result-row"><span>{mode === 'shortest' || mode === 'emergency' ? 'Explored nodes' : 'Traversal order'}</span><strong>{frame.visited.length ? frame.visited.join(' → ') : '—'}</strong></div><div className="result-row"><span>{mode === 'dfs' || mode === 'inspection' ? 'Stack' : 'Queue / frontier'}</span><code>[{frame.frontier.join(', ')}]</code></div>{(mode === 'shortest' || mode === 'emergency') && finished && <><div className="result-row"><span>Shortest route</span><strong className="route-text">{path.join(' → ') || 'No route'}</strong></div><div className="result-split"><div><small>DISTANCE</small><strong>{routeDistance.toFixed(1)} km</strong></div><div><small>EST. TRAVEL TIME</small><strong>{Math.ceil(routeDistance / 35 * 60)} min</strong></div></div><div className="result-row"><span>Pipeline condition</span><strong>{pathPipeIds(path).some(id => pipes.find(p => p.id === id)?.condition === 'leak') ? 'Leak along route' : 'Passable'}</strong></div></>}{mode === 'leak-search' && finished && <div className="result-row"><span>Nearby sensors · {nearbySensors.length}</span><strong>{nearbySensors.map(n => n.sensor).join(', ') || 'None found'}</strong></div>}{(mode === 'inspection' || mode === 'dfs') && finished && <div className="result-row"><span>Reachable nodes</span><strong>{totalVisited} / {nodes.length}</strong></div>}<p className="step-note">{frame.note}</p></div> : <div className="empty-result"><div className="empty-icon"><GitBranch size={23} /></div><strong>Ready to explore</strong><p>Choose an algorithm and run it to see the traversal unfold here.</p></div>}
            </section>
          </div>
        </div>
        <div className="lower-grid"><section className="panel analytics-panel" id="analytics"><div className="panel-heading"><div><div className="section-kicker">PERFORMANCE METRICS</div><h2>Network analytics</h2><p>Simulated operational trends and insights</p></div><div className="period-tabs">{['Daily', 'Weekly', 'Monthly'].map(p => <Button key={p} variant="ghost" className={period === p ? 'selected' : ''} onClick={() => setPeriod(p)}>{p}</Button>)}</div></div><div className="chart-tabs">{chartOptions.map(c => <Button key={c} variant="ghost" className={chart === c ? 'selected' : ''} onClick={() => setChart(c)}>{c}</Button>)}</div><div className="chart-heading"><div><span>{chart}</span><strong>{chart === 'Water flow' ? '94.2 L/min' : chart === 'Pressure' ? '4.2 bar' : chart === 'Water loss' ? '8,450 L/day' : chart === 'Sensor activity' ? '20 active' : chart === 'Leak frequency' ? '4 incidents' : '2 closed'}</strong></div><span className="chart-trend"><ArrowDownRight size={15} /> 2.4% vs previous period</span></div><div className="chart-area"><ResponsiveContainer width="100%" height="100%">{chart === 'Leak frequency' || chart === 'Pipeline failures' || chart === 'Sensor activity' ? <BarChart data={chartData} margin={{ top: 10, right: 8, left: -27, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" /><XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} interval={2} /><YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--foreground)' }} /><Bar dataKey={chartKey[chart] ?? "flow"} fill="var(--chart-line)" radius={[3, 3, 0, 0]} /></BarChart> : <AreaChart data={chartData} margin={{ top: 10, right: 8, left: -27, bottom: 0 }}><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-line)" stopOpacity={.22} /><stop offset="100%" stopColor="var(--chart-line)" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" /><XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} interval={2} /><YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--foreground)' }} /><Area type="monotone" dataKey={chartKey[chart] ?? "flow"} stroke="var(--chart-line)" strokeWidth={2.5} fill="url(#chartFill)" /></AreaChart>}</ResponsiveContainer></div></section>
        <section className="panel alerts-panel" id="alerts"><div className="panel-heading"><div><div className="section-kicker">NEEDS ATTENTION</div><h2>Recent alerts <span className="alert-count">4</span></h2><p>Network events requiring review</p></div><Bell size={18} className="panel-muted-icon" /></div><div className="alert-list">{alerts.map((alert, i) => <div className="alert-item" key={i}><span className={`alert-icon alert-${alert.severity}`}>{alert.severity === 'critical' ? <AlertCircle size={16} /> : alert.severity === 'warning' ? <Gauge size={16} /> : <CircleHelp size={16} />}</span><div className="alert-body"><strong>{alert.title}</strong><span>{alert.detail}</span><Button variant="link" onClick={() => centerNode(alert.node)}>View on graph <ArrowRight size={13} /></Button></div><span className="alert-time">{i === 0 ? '2m' : i === 1 ? '18m' : i === 2 ? '1h' : '3h'}</span></div>)}</div></section></div>
        <div className="bottom-grid"><section className="panel detection-panel"><div className="panel-heading compact"><div><div className="section-kicker">LEAK INTELLIGENCE</div><h2>Active leak assessment</h2></div><span className="critical-tag"><span /> CRITICAL</span></div><div className="detection-body"><div className="detection-symbol"><Droplets size={28} /></div><div className="detection-copy"><strong>Possible leak detected</strong><p>Sensor S-04 identified a significant pressure drop near Node D / Pipeline P-104.</p><div className="detection-stats"><div><small>CURRENT PRESSURE</small><strong>2.1 <em>bar</em></strong></div><div><small>NORMAL PRESSURE</small><strong>4.8 <em>bar</em></strong></div><div><small>LEAK PROBABILITY</small><strong>92<em>%</em></strong></div></div></div></div><Button variant="outline" className="detection-link" onClick={() => { setStart('D'); switchMode('leak-search'); centerNode('D'); }}>Investigate with BFS <ArrowRight size={15} /></Button></section>
        <section className="panel knowledge-panel"><div className="panel-heading compact"><div><div className="section-kicker">UNDER THE HOOD</div><h2>Graph algorithm guide</h2></div><CircleHelp size={18} className="panel-muted-icon" /></div><div className="knowledge-list"><div><span className="knowledge-icon"><Layers3 size={17} /></span><div><strong>Graph network</strong><p>Junctions are vertices; pipelines are weighted edges.</p></div></div><div><span className="knowledge-icon"><Search size={17} /></span><div><strong>Breadth-first search</strong><p>Explores level by level to discover nearby sensors.</p></div></div><div><span className="knowledge-icon"><GitBranch size={17} /></span><div><strong>Depth-first search</strong><p>Follows branches to inspect connected regions.</p></div></div><div><span className="knowledge-icon"><RouteIcon size={17} /></span><div><strong>Dijkstra's algorithm</strong><p>Finds the lowest-distance maintenance route.</p></div></div></div></section></div>
        <footer className="page-footer"><span>© 2026 AquaGrid · Educational prototype</span><span>Demo / Simulated Data · Not connected to real infrastructure</span></footer>
      </div>
    </main>
  </div>;
}
function Metric({ icon: Icon, label, value, suffix, change, tone }: { icon: typeof Layers3; label: string; value: string; suffix?: string; change: string; tone: string }) {
  return <div className="metric"><div className="metric-top"><span className={`metric-icon tone-${tone}`}><Icon size={19} strokeWidth={1.9} /></span><span className="metric-spark"><span /></span></div><span className="metric-label">{label}</span><div className="metric-value">{value}{suffix && <small> {suffix}</small>}</div><div className="metric-change"><span className={`change-dot tone-${tone}`} />{change}</div></div>;
}
