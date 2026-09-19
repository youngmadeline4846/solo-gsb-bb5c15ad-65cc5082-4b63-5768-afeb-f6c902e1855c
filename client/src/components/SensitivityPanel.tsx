import type { Edge, Node } from 'reactflow';
import type { Stance } from '../../../shared/graph';
import type { ArgumentNodeData } from './ArgumentNode';
import { SensitivityChart } from './SensitivityChart';
import type { EdgeWeightSensitivity } from '../../../shared/graph';

interface SensitivityPanelProps {
  /** 当前选中的连线；未选中连线时不显示扫描面板 */
  edge: Edge;
  nodes: Node<ArgumentNodeData>[];
  targetNodeId: string;
  onTargetNodeChange: (id: string) => void;
  onRun: () => void;
  scanning: boolean;
  sensitivity: EdgeWeightSensitivity | null;
  error: string | null;
}

const formatWeight = (value: number) => `${(value * 100).toFixed(0)}%`;

/**
 * 边权敏感性扫描面板。扫描请求把当前画布图一并发给服务端，
 * 服务端在内存副本上把边权从 0 到 1 等距取 21 个值计算，不保存图。
 */
export function SensitivityPanel({
  edge,
  nodes,
  targetNodeId,
  onTargetNodeChange,
  onRun,
  scanning,
  sensitivity,
  error
}: SensitivityPanelProps) {
  const stance = (edge.data?.stance as Stance) ?? 'support';
  const edgeWeight = Number(edge.data?.weight ?? 0.6);
  const sourceLabel = nodes.find((node) => node.id === edge.source)?.data.label ?? edge.source;
  const targetLabel = nodes.find((node) => node.id === edge.target)?.data.label ?? edge.target;
  const band = sensitivity?.thresholdBand ?? null;

  return (
    <section className="panel-card sensitivity-card">
      <h2>边权敏感性扫描</h2>
      <p className="hint">
        当前连线：{sourceLabel} {stance === 'support' ? '支持' : '反驳'} {targetLabel}（权重{' '}
        {formatWeight(edgeWeight)}）。扫描在服务端内存副本上进行，把边权从 0 到 1 等距取 21 个值分别计算，
        <strong>不会保存图</strong>。
      </p>
      <label className="field">
        <span>目标节点</span>
        <select value={targetNodeId} onChange={(event) => onTargetNodeChange(event.target.value)}>
          {nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.data.label}
            </option>
          ))}
        </select>
      </label>
      <button className="primary sensitivity-run" disabled={scanning || nodes.length === 0} onClick={onRun}>
        {scanning ? '扫描中…' : '扫描边权 0–1（21 点）'}
      </button>

      {error && <p className="sensitivity-error">{error}</p>}

      {sensitivity && (
        <div className="sensitivity-body">
          {band ? (
            <p className="sensitivity-band">
              阈值区间：边权在 <strong>{formatWeight(band.fromWeight)} – {formatWeight(band.toWeight)}</strong>{' '}
              之间首次{band.direction === 'upward' ? '向上跨过 0.5' : '向下跨过 0.5'}（目标值{' '}
              {band.fromValue.toFixed(3)} → {band.toValue.toFixed(3)}）。
            </p>
          ) : (
            <p className="hint">
              21 个采样点中没有连续收敛点跨过 0.5（振荡或达到上限的点不参与跨越判断）。
            </p>
          )}
          <SensitivityChart sensitivity={sensitivity} />
        </div>
      )}
    </section>
  );
}
