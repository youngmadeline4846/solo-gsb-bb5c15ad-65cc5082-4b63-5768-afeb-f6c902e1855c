import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  useEdgesState,
  useNodesState,
  MarkerType,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler
} from 'reactflow';
import 'reactflow/dist/style.css';
import { api } from './api';
import { ArgumentNode, nodeTypes, type ArgumentNodeData } from './components/ArgumentNode';
import { SidePanel, graphToDocument } from './components/SidePanel';
import { ReplayBar } from './components/ReplayBar';
import { buildRoundDecomposition } from './replay';
import type {
  EdgeWeightSensitivity,
  GraphDocument,
  GraphNode,
  GraphEdge,
  PropagateOptions,
  PropagateResult,
  Stance
} from '../../shared/graph';
import { stableSample, oscillatingSample } from './samples';

const DEFAULT_OPTIONS: PropagateOptions = { threshold: 0.001, maxIterations: 200, lambda: 0.8 };

const documentToFlow = (graph: GraphDocument): { nodes: Node<ArgumentNodeData>[]; edges: Edge[] } => ({
  nodes: graph.nodes.map((node) => ({
    id: node.id,
    type: 'argument',
    position: node.position,
    data: {
      label: node.label,
      kind: node.kind,
      initialBelief: node.initialBelief,
      anchored: node.anchored
    }
  })),
  edges: graph.edges.map((edge) => makeEdge(edge))
});

function makeEdge(edge: GraphEdge): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: `${edge.stance === 'support' ? '支持' : '反驳'} ${Math.round(edge.weight * 100)}%`,
    animated: false,
    data: { stance: edge.stance, weight: edge.weight },
    className: `stance-${edge.stance}`,
    markerEnd: { type: MarkerType.ArrowClosed }
  };
}

function decorateEdge(edge: Edge, highlighted: boolean): Edge {
  const stance = (edge.data?.stance as Stance) ?? 'support';
  const weight = Number(edge.data?.weight ?? 0.6);
  return {
    ...edge,
    label: `${stance === 'support' ? '支持' : '反驳'} ${Math.round(weight * 100)}%`,
    className: `stance-${stance} ${highlighted ? 'cycle-edge' : ''}`,
    animated: highlighted,
    style: highlighted ? { strokeWidth: 4 } : undefined,
    markerEnd: { type: MarkerType.ArrowClosed }
  };
}

let localCounter = 0;
const createId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(localCounter += 1)}`;

/** 用第 round 轮的轨迹值刷新节点显示（纯视图更新，不保存、不重新计算）。 */
function decorateNodesForRound(
  current: Node<ArgumentNodeData>[],
  result: PropagateResult,
  round: number,
  cycleNodeIds: Set<string>
): Node<ArgumentNodeData>[] {
  return current.map((node) => {
    const trace = result.traces[node.id];
    if (!trace || trace.length === 0) {
      return { ...node, data: { ...node.data, displayBelief: undefined, roundDelta: undefined, inCycle: false } };
    }
    const clamped = Math.max(0, Math.min(round, trace.length - 1));
    const value = trace[clamped];
    return {
      ...node,
      data: {
        ...node.data,
        displayBelief: value,
        roundDelta: clamped > 0 ? value - trace[clamped - 1] : undefined,
        inCycle: cycleNodeIds.has(node.id)
      }
    };
  });
}

export default function App() {
  const [documentName, setDocumentName] = useState('我的论证图');
  const [nodes, setNodes, onNodesChange] = useNodesState<ArgumentNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [options, setOptions] = useState<PropagateOptions>(DEFAULT_OPTIONS);
  const [result, setResult] = useState<PropagateResult | null>(null);
  const [replayRound, setReplayRound] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [status, setStatus] = useState('正在加载…');
  const [busy, setBusy] = useState(false);
  const [sensitivity, setSensitivity] = useState<EdgeWeightSensitivity | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [sensitivityTargetNodeId, setSensitivityTargetNodeId] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const scheduleSave = useCallback(
    (nextNodes = nodes, nextEdges = edges, immediate = false) => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      const run = () => {
        setStatus('正在保存…');
        api
          .saveGraph(graphToDocument(documentName, nextNodes, nextEdges))
          .then(() => setStatus('已自动保存到 SQLite'))
          .catch((error: Error) => setStatus(`保存失败：${error.message}`));
      };
      if (immediate) run();
      else saveTimerRef.current = window.setTimeout(run, 700);
    },
    [documentName, edges, nodes]
  );

  useEffect(() => {
    api
      .getGraph()
      .then(({ graph }) => {
        const flow = documentToFlow(graph);
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setDocumentName(graph.name ?? '我的论证图');
        setStatus('已从 SQLite 载入');
      })
      .catch((error: Error) => setStatus(`加载失败：${error.message}`));
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
    // 仅在启动时加载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearAnalysis = useCallback(
    (nextNodes = nodes, nextEdges = edges) => {
      setResult(null);
      setReplayRound(0);
      setPlaying(false);
      // 任何图编辑都会使旧的边权扫描结果失效（扫描点基于旧图）。
      setSensitivity(null);
      setScanError(null);
      setNodes(
        nextNodes.map((node) => ({
          ...node,
          data: { ...node.data, displayBelief: undefined, roundDelta: undefined, inCycle: false }
        }))
      );
      setEdges(nextEdges.map((edge) => decorateEdge({ ...edge, animated: false, style: undefined }, false)));
    },
    [edges, nodes, setEdges, setNodes]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const edge = makeEdge({
        id: createId('edge'),
        source: connection.source,
        target: connection.target,
        stance: 'support',
        weight: 0.6
      });
      const nextEdges = [...edges, edge];
      clearAnalysis(nodes, nextEdges);
      scheduleSave(nodes, nextEdges, true);
    },
    [clearAnalysis, edges, nodes, scheduleSave, setEdges]
  );

  const onNodeDragStop: NodeMouseHandler = useCallback(
    (_event, node) => {
      // 位置变化不清除计算结果，但需要持久化布局。
      const nextNodes = nodes.map((item) => (item.id === node.id ? node : item));
      scheduleSave(nextNodes, edges);
    },
    [edges, nodes, scheduleSave]
  );

  const addNode = (kind: 'claim' | 'evidence') => {
    const id = createId(kind);
    const node: Node<ArgumentNodeData> = {
      id,
      type: 'argument',
      position: { x: 120 + Math.random() * 220, y: 90 + Math.random() * 260 },
      data: {
        label: kind === 'evidence' ? `证据 ${nodes.length + 1}` : `观点 ${nodes.length + 1}`,
        kind,
        initialBelief: kind === 'evidence' ? 0.8 : 0.5,
        anchored: false
      }
    };
    const nextNodes = [...nodes, node];
    clearAnalysis(nextNodes, edges);
    scheduleSave(nextNodes, edges, true);
  };

  const updateNode = (id: string, patch: Partial<ArgumentNodeData>) => {
    const nextNodes = nodes.map((node) =>
      node.id === id ? { ...node, data: { ...node.data, ...patch } } : node
    );
    clearAnalysis(nextNodes, edges);
    scheduleSave(nextNodes, edges);
  };

  const updateEdge = (id: string, patch: { weight?: number; stance?: Stance }) => {
    const nextEdges = edges.map((edge) =>
      edge.id === id ? decorateEdge({ ...edge, data: { ...edge.data, ...patch } }, false) : edge
    );
    clearAnalysis(nodes, nextEdges);
    scheduleSave(nodes, nextEdges);
  };

  const deleteSelection = useCallback(() => {
    let nextNodes = nodes;
    let nextEdges = edges;
    if (selectedNodeId) {
      nextNodes = nodes.filter((node) => node.id !== selectedNodeId);
      nextEdges = edges.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId);
      setSelectedNodeId(null);
    } else if (selectedEdgeId) {
      nextEdges = edges.filter((edge) => edge.id !== selectedEdgeId);
      setSelectedEdgeId(null);
    } else {
      return;
    }
    clearAnalysis(nextNodes, nextEdges);
    scheduleSave(nextNodes, nextEdges, true);
  }, [
    clearAnalysis,
    edges,
    nodes,
    scheduleSave,
    selectedEdgeId,
    selectedNodeId,
    setEdges,
    setNodes
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === 'Delete' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        deleteSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelection]);

  const runPropagation = async () => {
    setBusy(true);
    setStatus('正在迭代传播…');
    try {
      // 先保存，确保后端计算的是当前画布。
      await api.saveGraph(graphToDocument(documentName, nodes, edges));
      const { result: nextResult } = await api.propagate(options);
      const cycleNodeIds = new Set(nextResult.cycles.flatMap((cycle) => cycle.nodeIds));
      const cycleEdgeIds = new Set(nextResult.cycles.flatMap((cycle) => cycle.edgeIds));
      setResult(nextResult);
      setPlaying(false);
      setReplayRound(nextResult.iterations);
      setNodes((current) => decorateNodesForRound(current, nextResult, nextResult.iterations, cycleNodeIds));
      setEdges((current) => current.map((edge) => decorateEdge(edge, cycleEdgeIds.has(edge.id))));
      setStatus(nextResult.message);
    } catch (error) {
      setStatus(`计算失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  // 回放只切换展示的轮次：不修改图、不保存、不重新计算。
  const goToRound = useCallback(
    (round: number) => {
      if (!result) return;
      const clamped = Math.max(0, Math.min(result.iterations, Math.round(round)));
      setReplayRound(clamped);
      const cycleNodeIds = new Set(result.cycles.flatMap((cycle) => cycle.nodeIds));
      setNodes((current) => decorateNodesForRound(current, result, clamped, cycleNodeIds));
    },
    [result, setNodes]
  );

  // 播放：收敛结果播到停止轮即停；振荡结果在最后一个周期内循环。
  useEffect(() => {
    if (!playing || !result) return;
    const loopable = Boolean(result.oscillating && result.detectedPeriod);
    if (replayRound >= result.iterations && !loopable) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      if (replayRound >= result.iterations && loopable) {
        goToRound(Math.max(0, result.iterations - (result.detectedPeriod ?? 1) + 1));
      } else {
        goToRound(replayRound + 1);
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [playing, replayRound, result, goToRound]);

  const togglePlay = () => {
    if (!result) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    // 收敛结果停在末轮时再按播放，从第 0 轮重新播放。
    const loopable = Boolean(result.oscillating && result.detectedPeriod);
    if (replayRound >= result.iterations && !loopable) goToRound(0);
    setPlaying(true);
  };

  const loadDocument = (graph: GraphDocument, immediateSave = true, nextOptions?: PropagateOptions) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    const flow = documentToFlow(graph);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setDocumentName(graph.name ?? '导入的论证图');
    setResult(null);
    setReplayRound(0);
    setPlaying(false);
    if (nextOptions) setOptions(nextOptions);
    if (immediateSave) {
      setStatus('正在导入…');
      api
        .saveGraph(graph)
        .then(() => setStatus('JSON 已导入并保存'))
        .catch((error: Error) => setStatus(`导入失败：${error.message}`));
    }
  };

  const exportJson = () => {
    const graphDocument = graphToDocument(documentName, nodes, edges);
    const blob = new Blob([JSON.stringify(graphDocument, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${documentName || 'argument-graph'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importJsonFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as GraphDocument | { graph: GraphDocument };
      const graph = 'graph' in parsed ? parsed.graph : parsed;
      // 后端执行严格校验并返回规范化文档。
      const saved = await api.saveGraph(graph);
      loadDocument(saved.graph, false);
      setStatus('JSON 已导入并保存');
    } catch (error) {
      setStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId),
    [nodes, selectedNodeId]
  );
  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId),
    [edges, selectedEdgeId]
  );

  // 扫描目标：显式选择生效；未选或已失效时退回连线指向的节点。
  const effectiveSensitivityTarget = useMemo(() => {
    if (!selectedEdge) return '';
    const stillExists = nodes.some((node) => node.id === sensitivityTargetNodeId);
    return stillExists ? sensitivityTargetNodeId : selectedEdge.target;
  }, [nodes, selectedEdge, sensitivityTargetNodeId]);

  const runSensitivity = useCallback(async () => {
    if (!selectedEdge || !effectiveSensitivityTarget) return;
    setScanning(true);
    setScanError(null);
    try {
      // 把当前画布（含尚未保存的编辑）发给服务端：只在其内存副本上扫描，不保存。
      const { sensitivity: nextSensitivity } = await api.scanSensitivity({
        edgeId: selectedEdge.id,
        targetNodeId: effectiveSensitivityTarget,
        options,
        graph: graphToDocument(documentName, nodes, edges)
      });
      setSensitivity(nextSensitivity);
    } catch (error) {
      setSensitivity(null);
      setScanError(`扫描失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setScanning(false);
    }
  }, [documentName, effectiveSensitivityTarget, edges, nodes, options, selectedEdge]);

  // 选中节点时，本地重算「当前轮 → 下一轮」的可核对分解。
  const decomposition = useMemo(() => {
    if (!result || !selectedNode) return null;
    return buildRoundDecomposition(selectedNode, nodes, edges, result, replayRound);
  }, [result, selectedNode, nodes, edges, replayRound]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>论证稳定性沙盘</h1>
          <input
            className="document-name"
            value={documentName}
            onChange={(event) => setDocumentName(event.target.value)}
            onBlur={() => scheduleSave(nodes, edges, true)}
          />
        </div>
        <div className="toolbar">
          <button onClick={() => addNode('claim')}>＋ 观点</button>
          <button onClick={() => addNode('evidence')}>＋ 证据</button>
          <button className="primary" disabled={busy || nodes.length === 0} onClick={runPropagation}>
            {busy ? '计算中…' : '运行稳定性分析'}
          </button>
          <button onClick={() => loadDocument(stableSample, true, DEFAULT_OPTIONS)}>载入稳定示例</button>
          <button onClick={() => loadDocument(oscillatingSample, true, { ...DEFAULT_OPTIONS, lambda: 1 })}>
            载入振荡示例
          </button>
          <button onClick={exportJson} disabled={nodes.length === 0}>
            导出 JSON
          </button>
          <button onClick={() => fileInputRef.current?.click()}>导入 JSON</button>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importJsonFile(file);
              event.target.value = '';
            }}
          />
        </div>
      </header>

      <main className="workspace">
        <div className="canvas-wrap">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_event, node) => {
              setSelectedNodeId(node.id);
              setSelectedEdgeId(null);
            }}
            onEdgeClick={(_event, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeId(null);
              // 切换选中连线时，默认把连线本身指向的节点作为扫描目标。
              setSensitivityTargetNodeId(edge.target);
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
            }}
            onNodesDelete={(deleted) => {
              if (deleted.some((node) => node.id === selectedNodeId)) setSelectedNodeId(null);
            }}
            onEdgesDelete={(deleted) => {
              if (deleted.some((edge) => edge.id === selectedEdgeId)) setSelectedEdgeId(null);
            }}
            fitView
            deleteKeyCode={null}
            connectionLineStyle={{ stroke: '#2563eb' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#c7d2fe" />
            <Controls />
          </ReactFlow>
          <div className="canvas-footer">
            {result ? (
              <ReplayBar
                result={result}
                round={replayRound}
                playing={playing}
                onSeek={goToRound}
                onTogglePlay={togglePlay}
              />
            ) : (
              <span className="canvas-footer-spacer" />
            )}
            <div className={`status-pill ${result?.oscillating ? 'bad' : result?.converged ? 'good' : ''}`}>
              {status}
            </div>
          </div>
        </div>

        <SidePanel
          options={options}
          onOptionsChange={setOptions}
          result={result}
          selection={{ node: selectedNode, edge: selectedEdge }}
          decomposition={decomposition}
          onUpdateNode={updateNode}
          onUpdateEdge={updateEdge}
          onDeleteSelection={deleteSelection}
          nodes={nodes}
          sensitivity={sensitivity}
          sensitivityTargetNodeId={effectiveSensitivityTarget}
          scanning={scanning}
          scanError={scanError}
          onSensitivityTargetChange={setSensitivityTargetNodeId}
          onRunSensitivity={runSensitivity}
        />
      </main>
    </div>
  );
}
