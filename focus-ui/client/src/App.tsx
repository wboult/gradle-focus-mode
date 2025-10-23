import { useEffect, useState, useRef, useMemo } from 'react';
import cytoscape, { type Core } from 'cytoscape';
// @ts-ignore
import klay from 'cytoscape-klay';
import { io, Socket } from 'socket.io-client';
import {
  Search,
  Save,
  Play,
  Layers,
  Target,
  GitFork,
  Info,
  X,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Locate,
  FileText,
  Focus,
  RotateCcw
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

cytoscape.use(klay);

// --- Types ---
interface NodeData {
  id: string;
  label: string;
}

interface EdgeData {
  from: string;
  to: string;
}

interface GraphData {
  nodes: NodeData[];
  edges: EdgeData[];
}

interface Config {
  focusedProjects: string[];
  downstreamHops: number;
}

type Tab = 'focused' | 'included' | 'all';

// --- API Mocking (If backend is missing during dev, otherwise these should point to real endpoints) ---
// In a real scenario, these would likely be relative paths like '/api/config' as in the original.
// For this standalone component to work if the user just runs it, we'll assume the original server is running on localhost:3000
// or relative if served from the same origin. Defaulting to relative for compatibility with original.
const API_BASE = '/api';

const api = {
  getConfig: async (): Promise<Config> => {
    const res = await fetch(`${API_BASE}/config`);
    if (!res.ok) throw new Error('Failed to load config');
    return res.json();
  },
  getGraph: async (): Promise<GraphData> => {
    const res = await fetch(`${API_BASE}/graph`);
    if (!res.ok) throw new Error('Failed to load graph');
    return res.json();
  },
  saveConfig: async (config: Config): Promise<void> => {
    const res = await fetch(`${API_BASE}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error('Failed to save config');
    return res.json();
  },
  applyIdea: async (): Promise<{ success: boolean; error?: string }> => {
    const res = await fetch(`${API_BASE}/applyIdea`, { method: 'POST' });
    return res.json();
  }
};

// --- Main Component ---
export default function FocusModeDashboard() {
  // -- State --
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [focusedProjects, setFocusedProjects] = useState<Set<string>>(new Set());
  const [downstreamHops, setDownstreamHops] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [status, setStatus] = useState<{ msg: string; type: 'idle'|'success'|'error'|'loading' }>({ msg: 'Ready', type: 'idle' });
  
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('focused');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [fileChangeNotification, setFileChangeNotification] = useState<{ changedProjects: string[] } | null>(null);
  const accumulatedChanges = useRef<Set<string>>(new Set());

  // Track saved state for button awareness
  const [savedConfig, setSavedConfig] = useState<{focusedProjects: string[], downstreamHops: number} | null>(null);
  const [ideUpdated, setIdeUpdated] = useState<boolean>(false);

  const cyRef = useRef<Core | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  // -- Derived Data (Memoized for performance) --
  // Check if config needs saving
  const configNeedsSaving = useMemo(() => {
    if (!savedConfig) return true;
    const currentFocused = Array.from(focusedProjects).sort();
    const savedFocused = savedConfig.focusedProjects.sort();
    return currentFocused.join(',') !== savedFocused.join(',') || downstreamHops !== savedConfig.downstreamHops;
  }, [focusedProjects, downstreamHops, savedConfig]);
  // Adjacency list for quick lookups: who depends on me? (reverse dependencies)
  const dependentsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    graphData.nodes.forEach(n => map.set(n.id, []));
    graphData.edges.forEach(edge => {
      // Edge is: from -> to (from depends on to)
      // We want: to -> [froms] (dependents of to)
      if (!map.has(edge.to)) map.set(edge.to, []);
      map.get(edge.to)?.push(edge.from);
    });
    return map;
  }, [graphData]);

  // Adjacency list: what do I depend on? (direct dependencies)
  const dependenciesMap = useMemo(() => {
    const map = new Map<string, string[]>();
    graphData.nodes.forEach(n => map.set(n.id, []));
    graphData.edges.forEach(edge => {
      map.get(edge.from)?.push(edge.to);
    });
    return map;
  }, [graphData]);

  // Calculate included projects based on current focus & hops
  const includedProjects = useMemo(() => {
    const included = new Set<string>();
    const visited = new Set<string>();

    const addDependents = (proj: string, hops: number) => {
      if (hops < 0 || visited.has(`${proj}-${hops}`)) return;
      visited.add(`${proj}-${hops}`); // Simple visited key to avoid infinite cycles if graph is malformed, though standard DAGs shouldn't have them.
      
      if (!included.has(proj)) included.add(proj);

      const deps = dependentsMap.get(proj) || [];
      deps.forEach(dep => addDependents(dep, hops - 1));
    };

    if (focusedProjects.size === 0) {
      // When no projects are focused, include all projects
      graphData.nodes.forEach(n => included.add(n.id));
    } else {
      focusedProjects.forEach(proj => {
        // The project itself is included (hops don't apply to self)
        included.add(proj);
        // Add its dependents up to N hops
        addDependents(proj, downstreamHops);
      });
    }

    return included;
  }, [focusedProjects, downstreamHops, dependentsMap, graphData.nodes]);

  // Filtered lists for sidebar
  const projectLists = useMemo(() => {
    const all = graphData.nodes.filter(n => n.label.toLowerCase().includes(searchQuery.toLowerCase())).sort((a, b) => a.label.localeCompare(b.label));
    const focused = all.filter(n => focusedProjects.has(n.id));
    const includedOnly = all.filter(n => includedProjects.has(n.id) && !focusedProjects.has(n.id));
    return { all, focused, includedOnly };
  }, [graphData.nodes, focusedProjects, includedProjects, searchQuery]);

  // -- Effects --

  // Initial Load
  useEffect(() => {
    async function load() {
      try {
        setIsLoading(true);
        const [conf, graph] = await Promise.all([api.getConfig(), api.getGraph()]);
        setGraphData(graph);
        setFocusedProjects(new Set(conf.focusedProjects));
        setDownstreamHops(conf.downstreamHops);
        setSavedConfig({ focusedProjects: conf.focusedProjects, downstreamHops: conf.downstreamHops });
        setIdeUpdated(true); // Assume IDE is up to date with loaded config
        setStatus({ msg: 'Data loaded successfully', type: 'success' });
      } catch (e: any) {
        setStatus({ msg: e.message || 'Error loading data', type: 'error' });
      } finally {
        setIsLoading(false);
      }
    }
    load();

    // Connect to socket.io for real-time updates
    socketRef.current = io();
    socketRef.current.on('file-changes', (data: { changedProjects: string[] }) => {
      // Accumulate new changes with existing ones
      data.changedProjects.forEach(proj => accumulatedChanges.current.add(proj));
      if (accumulatedChanges.current.size > 0) {
        setFileChangeNotification({ changedProjects: Array.from(accumulatedChanges.current) });
      }
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current || isLoading || graphData.nodes.length === 0) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...graphData.nodes.map(n => ({ group: 'nodes', data: { id: n.id, label: n.label } })),
        ...graphData.edges.map(e => ({ group: 'edges', data: { id: `${e.from}-${e.to}`, source: e.from, target: e.to } }))
      ] as any,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'color': '#1f2937', // gray-800
            'font-size': '12px',
            'font-weight': 'bold',
            'background-color': '#e5e7eb', // gray-200
            'border-width': 2,
            'border-color': '#9ca3af', // gray-400
            'width': 'label',
            'height': 'label',
            'padding': '12px',
            'shape': 'round-rectangle',
            'text-wrap': 'wrap',
            'text-max-width': '120px',
            'transition-property': 'background-color, border-color, opacity',
            'transition-duration': 200
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': '#e5e7eb', // gray-200
            'target-arrow-color': '#e5e7eb',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 1.2
          }
        },
        {
          selector: ':selected',
          style: {
            'border-width': 4,
            'border-color': '#3b82f6' // blue-500
          }
        }
      ],
      layout: {
        name: 'klay',
        // @ts-ignore
        klay: {
          direction: 'DOWN',
          spacing: 40
        },
        animationDuration: 500
      }
    });

    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      const id = node.id();
      
      // Select for details view
      setSelectedNodeId(id);

      // Toggle focus on click
      setFocusedProjects(prev => {
        const next = new Set(prev);
        const wasFocused = next.has(id);
      if (wasFocused) {
        next.delete(id);
        // Immediately update style for unfocused
        node.style({
            'background-color': includedProjects.has(id) ? '#f3f4f6' : '#f1f5f9',
            'border-color': includedProjects.has(id) ? '#6b7280' : '#cbd5e1'
          });
        } else {
          next.add(id);
          // Immediately update style for focused
          node.style({
            'background-color': '#fecaca',
            'border-color': '#ef4444'
          });
        }
        return next;
      });
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelectedNodeId(null);
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
    };
  }, [isLoading, graphData]); // Re-init only if complete graph data changes drastically

  // Update Visuals when state changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.nodes().forEach(node => {
        const id = node.id();
        const isFocused = focusedProjects.has(id);
        const isIncluded = includedProjects.has(id);
        const matchesSearch = !searchQuery || node.data('label').toLowerCase().includes(searchQuery.toLowerCase());

        // Opacity based on inclusion AND search
        let opacity = isIncluded ? 1 : 0.4;
        if (!matchesSearch) opacity = 0.2;

        node.style({
          'background-color': isFocused ? '#fecaca' : (isIncluded ? '#f3f4f6' : '#f1f5f9'), // red-200 : gray-100 : slate-50
          'border-color': isFocused ? '#ef4444' : (isIncluded ? '#6b7280' : '#cbd5e1'),     // red-500 : gray-500 : slate-300
          'color': isIncluded ? '#111827' : '#475569', // gray-900 : slate-600 (darker for better contrast)
          'opacity': opacity,
          'text-opacity': 1 // Keep text fully visible even on faded nodes
        });
      });

      cy.edges().forEach(edge => {
        const sourceIncluded = includedProjects.has(edge.data('source'));
        const targetIncluded = includedProjects.has(edge.data('target'));
        const isRelevant = sourceIncluded && targetIncluded;

        edge.style({
          'line-color': isRelevant ? '#94a3b8' : '#f3f4f6', // slate-400 : gray-100
          'target-arrow-color': isRelevant ? '#94a3b8' : '#f3f4f6',
          'width': isRelevant ? 3 : 1,
          'z-index': isRelevant ? 10 : 0,
          'opacity': isRelevant ? 1 : 0.2
        });
      });
    });
  }, [focusedProjects, includedProjects, searchQuery, selectedNodeId]);


  // -- Handlers --
  const handleUpdateConfig = async () => {
    try {
      setStatus({ msg: 'Saving config...', type: 'loading' });
      await api.saveConfig({
        focusedProjects: Array.from(focusedProjects),
        downstreamHops
      });
      setSavedConfig({ focusedProjects: Array.from(focusedProjects), downstreamHops });
      setIdeUpdated(false); // IDE needs update after config change
      setStatus({ msg: 'Config saved successfully.', type: 'success' });
      setTimeout(() => setStatus({ msg: 'Ready', type: 'idle' }), 3000);
    } catch (e: any) {
      setStatus({ msg: 'Error saving: ' + e.message, type: 'error' });
    }
  };

  const handleApplyIdea = async () => {
    try {
      setStatus({ msg: 'Applying IDEA exclusions...', type: 'loading' });
      const res = await api.applyIdea();
      if (res.success) {
        setIdeUpdated(true);
        setStatus({ msg: 'IDEA exclusions applied.', type: 'success' });
      } else {
        setStatus({ msg: 'Error applying: ' + res.error, type: 'error' });
      }
    } catch (e: any) {
      setStatus({ msg: 'Error: ' + e.message, type: 'error' });
    }
  };

  const toggleFocus = (id: string) => {
    setFocusedProjects(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // When focus changes, IDE needs updating
    setIdeUpdated(false);
    // Remove from accumulated changes when focused
    accumulatedChanges.current.delete(id);
    if (accumulatedChanges.current.size === 0) {
      setFileChangeNotification(null);
    } else {
      setFileChangeNotification({ changedProjects: Array.from(accumulatedChanges.current) });
    }
  };

  const centerGraph = () => {
    cyRef.current?.fit(undefined, 50);
  };


  // -- Sub-components (inline for single file) --

  const NodeDetailsPanel = () => selectedNodeId ? (
  <div className="bg-white rounded-lg shadow-lg border border-gray-200 w-80 max-h-96 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200">
  <div className="p-3 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
  <h2 className="font-bold text-sm flex items-center gap-2 truncate">
  <Info size={16} className="text-blue-500"/>
  <span className="truncate">{selectedNodeId}</span>
  </h2>
  <button onClick={() => setSelectedNodeId(null)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded">
  <X size={16} />
  </button>
  </div>

  <div className="max-h-80 overflow-y-auto p-4 space-y-4">
  {/* Focus Status Toggle for Selected */}
  <div className="flex items-center justify-between">
  <span className="text-sm font-medium text-gray-700">Focus Status</span>
  <button
  onClick={() => toggleFocus(selectedNodeId)}
  className={cn(
  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors",
  focusedProjects.has(selectedNodeId)
  ? "bg-red-100 text-red-700 hover:bg-red-200"
  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
  )}
  >
  <Target size={12} />
  {focusedProjects.has(selectedNodeId) ? 'FOCUSED' : 'NOT FOCUSED'}
  </button>
  </div>

  {/* Dependencies Info */}
  <div>
  <h3 className="text-xs font-bold text-gray-500 uppercase mb-2 tracking-wider">Depends On (Upstream)</h3>
  <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
  {(dependenciesMap.get(selectedNodeId) || []).length === 0 ? (
  <div className="p-3 text-xs text-gray-400 italic">No direct dependencies</div>
  ) : (
  (dependenciesMap.get(selectedNodeId) || []).map(depId => (
  <div
  key={depId}
  onClick={() => setSelectedNodeId(depId)}
  className="p-2.5 text-sm border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer flex items-center gap-2"
  >
  <ChevronRight size={12} className="text-gray-400"/>
  <span className={cn(includedProjects.has(depId) ? "text-gray-900" : "text-gray-500")}>
  {graphData.nodes.find(n => n.id === depId)?.label || depId}
  </span>
  </div>
  ))
  )}
  </div>
  </div>

  <div>
  <h3 className="text-xs font-bold text-gray-500 uppercase mb-2 tracking-wider">Used By (Downstream)</h3>
  <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
  {(dependentsMap.get(selectedNodeId) || []).length === 0 ? (
  <div className="p-3 text-xs text-gray-400 italic">No downstream dependents</div>
  ) : (
  (dependentsMap.get(selectedNodeId) || []).map(depId => (
  <div
  key={depId}
  onClick={() => setSelectedNodeId(depId)}
  className="p-2.5 text-sm border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer flex items-center gap-2"
  >
  <ChevronDown size={12} className="text-gray-400"/>
  <span className={cn(includedProjects.has(depId) ? "text-gray-900" : "text-gray-500")}>
  {graphData.nodes.find(n => n.id === depId)?.label || depId}
  </span>
  {includedProjects.has(depId) && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 rounded ml-auto">Included</span>}
  </div>
  ))
  )}
  </div>
  </div>
  </div>
  </div>
  ) : null;

  const FileChangeNotification = () => fileChangeNotification ? (
    <div className="bg-white rounded-lg shadow-xl border border-gray-200 w-96 max-h-96 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200">
      <div className="p-4 border-b border-gray-200 bg-amber-50 flex justify-between items-center">
        <h2 className="font-bold text-sm flex items-center gap-2 text-amber-800">
          <FileText size={16} className="text-amber-600"/>
          Files Changed in Non-Focused Projects
        </h2>
        <button onClick={() => setFileChangeNotification(null)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded">
          <X size={16} />
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto p-4 space-y-3">
        <p className="text-sm text-gray-600">
          You've made changes to the following projects that are not currently focused. Would you like to focus them?
        </p>
        <div className="space-y-2">
          {fileChangeNotification.changedProjects.map(projId => (
            <div key={projId} className="flex items-center justify-between p-2 bg-gray-50 rounded border">
              <span className="text-sm font-medium">{projId}</span>
              <button
              onClick={() => {
              toggleFocus(projId);
              }}
              className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
              >
                <Focus size={12} />
                Focus
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-2">
        <button
        onClick={() => {
        fileChangeNotification.changedProjects.forEach(projId => toggleFocus(projId));
        }}
        className="flex-1 bg-blue-600 text-white py-2 px-3 rounded text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Focus All
        </button>
        <button
          onClick={() => {
          setFileChangeNotification(null);
          accumulatedChanges.current.clear();
          }}
        className="px-4 py-2 bg-gray-200 text-gray-700 rounded text-sm font-medium hover:bg-gray-300 transition-colors"
        >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const SidebarItem = ({ node, isFocused, isIncluded }: { node: NodeData, isFocused: boolean, isIncluded: boolean }) => (
    <div 
      className={cn(
        "flex items-center justify-between p-2 rounded-md text-sm cursor-pointer group transition-colors",
        isFocused ? "bg-red-50 hover:bg-red-100" : 
        isIncluded ? "bg-gray-50 hover:bg-gray-100" : "hover:bg-gray-50",
        selectedNodeId === node.id && "ring-2 ring-blue-500 inset-0"
      )}
      onClick={() => {
        setSelectedNodeId(node.id);
        cyRef.current?.$(`#${node.id}`).select();
      }}
    >
      <div className="flex items-center gap-2 truncate">
        <div className={cn(
          "w-3 h-3 rounded-full flex-shrink-0",
          isFocused ? "bg-red-500" : isIncluded ? "bg-gray-400" : "bg-gray-200"
        )} />
        <span className="truncate" title={node.label}>{node.label}</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-black/5 transition-opacity text-gray-500 hover:text-gray-700"
          onClick={(e) => {
          e.stopPropagation();
              const cytoscape = cyRef.current;
              if (cytoscape) {
                const cyNode = cytoscape.$(`#${node.id}`);
                if (cyNode.length > 0) {
                  cytoscape.fit(cyNode, 400);
                  // Ping effect: temporarily highlight the node
                  cyNode.animate({
                    style: { 'border-width': 6, 'border-color': '#3b82f6' },
                    duration: 300,
                    complete: () => {
                    cyNode.animate({
                      style: { 'border-width': 2 },
                    duration: 200
                    });
                    }
                  });
                }
              }
            }}
        title="Center on this project"
        >
          <Locate size={14} />
        </button>
        <button
            className={cn(
              "opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-black/5 transition-opacity",
              isFocused && "opacity-100 text-red-600"
            )}
            onClick={(e) => {
              e.stopPropagation();
              toggleFocus(node.id);
            }}
            title={isFocused ? "Unfocus" : "Focus"}
          >
            <Target size={14} />
          </button>
      </div>
    </div>
  );


  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-100 font-sans text-gray-900">
      
      {/* --- Sidebar --- */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col shadow-xl z-10 flex-shrink-0">
        
        {/* Header */}
        <div className="p-4 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold flex items-center gap-2 text-gray-800">
          <Layers className="text-blue-600" size={20} />
            Focus Mode
          </h1>
        <button
          onClick={() => setFocusedProjects(new Set())}
          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
          title="Reset focus (unfocus all projects)"
          >
          <RotateCcw size={16} />
        </button>
        </div>
        <div className={cn(
          "text-xs mt-1 flex items-center gap-1.5 font-medium",
            status.type === 'success' ? 'text-green-600' :
            status.type === 'error' ? 'text-red-600' :
            status.type === 'loading' ? 'text-blue-600' : 'text-gray-500'
          )}>
            {status.type === 'loading' && <div className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full" />}
            {status.type === 'success' && <CheckCircle2 size={12} />}
            {status.type === 'error' && <AlertCircle size={12} />}
            {status.msg}
          </div>
        </div>

        {/* Controls */}
        <div className="p-4 space-y-4 border-b border-gray-200">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input 
              type="text" 
              placeholder="Search projects..."
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Hops Slider */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <label htmlFor="hops" className="flex items-center gap-1 font-medium">
                <GitFork size={14} /> Downstream Hops
              </label>
              <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-bold">{downstreamHops}</span>
            </div>
            <input
            id="hops"
            type="range"
            min="0"
            max="10"
            className="w-full accent-blue-600 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            value={downstreamHops}
            onChange={(e) => {
                setDownstreamHops(parseInt(e.target.value));
                setIdeUpdated(false); // When hops change, IDE needs updating
              }}
            />
            <div className="flex justify-between text-xs text-gray-400 px-1">
              <span>0</span>
              <span>5</span>
              <span>10</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2">
          <button
          onClick={handleUpdateConfig}
          disabled={status.type === 'loading' || !configNeedsSaving}
          className={cn(
            "flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-colors",
            configNeedsSaving
              ? "bg-gray-900 text-white hover:bg-gray-800"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          )}
          title={configNeedsSaving ? "Save current focus configuration" : "Configuration is up to date"}
          >
          <Save size={14} /> Save Config
          </button>
          <button
          onClick={handleApplyIdea}
          disabled={status.type === 'loading' || ideUpdated}
          className={cn(
          "flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-colors",
          !ideUpdated
            ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-blue-100 text-blue-400 cursor-not-allowed"
          )}
          title={ideUpdated ? "IDEA exclusions are up to date" : "Apply focus exclusions to IntelliJ IDEA"}
          >
          <Play size={14} /> Apply to IDE
          </button>
          </div>
        </div>

        {/* Project Lists */}
        <div className="flex-1 flex flex-col min-h-0">
            {/* Tabs */}
            <div className="flex border-b border-gray-200 bg-gray-50 text-sm font-medium">
              {[ 
                { id: 'focused', label: 'Focused', count: projectLists.focused.length, color: 'text-red-600' },
                { id: 'included', label: 'Included', count: projectLists.includedOnly.length, color: 'text-gray-700' },
                { id: 'all', label: 'All', count: projectLists.all.length, color: 'text-gray-500' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as Tab)}
                  className={cn(
                    "flex-1 py-3 text-center border-b-2 transition-colors flex justify-center items-center gap-1.5",
                    activeTab === tab.id ? "border-blue-500 bg-white text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                  )}
                >
                  {tab.label}
                  <span className={cn("text-xs px-1.5 py-0.5 rounded-full bg-gray-200", activeTab === tab.id && "bg-blue-100 text-blue-700")}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-white">
              {activeTab === 'focused' && projectLists.focused.map(node => (
                <SidebarItem key={node.id} node={node} isFocused={true} isIncluded={true} />
              ))}
              {activeTab === 'included' && projectLists.includedOnly.map(node => (
                <SidebarItem key={node.id} node={node} isFocused={false} isIncluded={true} />
              ))}
              {activeTab === 'all' && projectLists.all.map(node => (
                <SidebarItem 
                  key={node.id} 
                  node={node} 
                  isFocused={focusedProjects.has(node.id)} 
                  isIncluded={includedProjects.has(node.id)} 
                />
              ))}

              {/* Empty States */}
              {activeTab === 'focused' && projectLists.focused.length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">
                  <Target className="mx-auto mb-2 opacity-50" size={24} />
                  No projects focused.
                  <br/>Click a node in the graph to focus.
                </div>
              )}
            </div>
          </div>
        </div>

      {/* --- Main Graph Area --- */}
      <div className="flex-1 relative flex flex-col">
        {isLoading && (
          <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-sm flex items-center justify-center flex-col gap-4 text-gray-500">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
            <p className="font-medium animate-pulse">Loading Dependency Graph...</p>
          </div>
        )}

        {selectedNodeId && (
        <div className="absolute top-4 right-4 z-40">
        <NodeDetailsPanel />
        </div>
        )}

        {fileChangeNotification && (
          <div className="absolute top-4 left-4 z-40">
            <FileChangeNotification />
          </div>
        )}

        <div ref={containerRef} className="flex-1 bg-slate-50" />

        {/* Floating Controls */}
        <div className="absolute bottom-6 right-6 flex flex-col gap-2 items-end">
           <button 
             onClick={centerGraph} 
             className="bg-white p-2 rounded-full shadow-md border border-gray-200 text-gray-600 hover:text-blue-600 hover:border-blue-300 transition-all active:scale-95"
             title="Center Graph"
           >
             <Target size={20} />
           </button>
           
           {/* Legend */}
           <div className="bg-white/95 backdrop-blur p-3 rounded-lg shadow-lg border border-gray-100 text-xs space-y-2 min-w-[140px]">
             <h4 className="font-bold text-gray-900 mb-2">Legend</h4>
             <div className="flex items-center gap-2">
               <div className="w-3 h-3 rounded-sm bg-red-200 border border-red-500" />
               <span className="text-gray-700">Focused Project</span>
             </div>
             <div className="flex items-center gap-2">
               <div className="w-3 h-3 rounded-sm bg-gray-100 border border-gray-500" />
               <span className="text-gray-700">Included Dependency</span>
             </div>
             <div className="flex items-center gap-2 opacity-50">
               <div className="w-3 h-3 rounded-sm bg-gray-200 border border-gray-300" />
               <span className="text-gray-700">Excluded</span>
             </div>
             <div className="h-px bg-gray-100 my-1" />
             <div className="flex items-center gap-2">
               <div className="w-6 h-0.5 bg-slate-400" />
               <span className="text-gray-700">Active Dependency</span>
             </div>
           </div>
        </div>

      </div>
    </div>
  );
}
