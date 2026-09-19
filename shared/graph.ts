export type NodeKind = 'claim' | 'evidence';
export type Stance = 'support' | 'rebut';

export interface Position {
  x: number;
  y: number;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** 初始先验可信度，范围 0..1 */
  initialBelief: number;
  /** 是否在传播中固定为先验值 */
  anchored: boolean;
  position: Position;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  stance: Stance;
  /** 关系强度，范围 0..1 */
  weight: number;
}

export interface GraphDocument {
  version: 1;
  name?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PropagateOptions {
  /** 收敛阈值：最大信念变化低于此值即收敛 */
  threshold: number;
  /** 最大迭代次数 */
  maxIterations: number;
  /** 传播/学习强度，0..1；1 表示允许强循环效应 */
  lambda: number;
}

export interface PropagationCycle {
  nodeIds: string[];
  edgeIds: string[];
  /** 反驳边数量 */
  rebutCount: number;
  /** 带符号乘积增益；奇数个反驳时为负 */
  signedGain: number;
  /** 该环节点在最近周期内的平均移动幅度 */
  activity: number;
}

export interface PropagateResult {
  converged: boolean;
  oscillating: boolean;
  iterations: number;
  finalBeliefs: Record<string, number>;
  /** 每个节点第 0 轮（先验）到停止轮的可信度轨迹，用于传播回放 */
  traces: Record<string, number[]>;
  maxChange: number;
  detectedPeriod: number | null;
  cycles: PropagationCycle[];
  /** 本次计算实际使用的参数（回放分解中的 λ 以此为准） */
  options: Required<PropagateOptions>;
  message: string;
}

export interface GraphApiResponse {
  graph: GraphDocument;
}

/** 边权扫描单点的终止状态：收敛 / 振荡 / 达到迭代上限 */
export type SensitivityStatus = 'converged' | 'oscillating' | 'limit';

export interface SensitivityPoint {
  /** 该采样点使用的边权，0..1 */
  weight: number;
  status: SensitivityStatus;
  /** 停止轮次（第 0 轮为先验） */
  iterations: number;
  /** 目标节点最终可信度；仅收敛时有值，振荡或未收敛为 null */
  targetValue: number | null;
  /** targetValue 为 null 时的原因说明 */
  reason: string | null;
  detectedPeriod: number | null;
}

export interface SensitivityThresholdBand {
  /** 跨越 0.5 的相邻采样区间下界边权 */
  fromWeight: number;
  /** 跨越 0.5 的相邻采样区间上界边权 */
  toWeight: number;
  fromValue: number;
  toValue: number;
  /** 随边权增大是向上还是向下跨过 0.5 */
  direction: 'upward' | 'downward';
}

export interface EdgeWeightSensitivity {
  edgeId: string;
  targetNodeId: string;
  /** 扫描时该连线的快照（ stance 与当前权重等），扫描本身不修改图 */
  edge: GraphEdge;
  targetNodeLabel: string;
  /** 本次 21 个采样点统一使用的传播参数 */
  options: Required<PropagateOptions>;
  /** 边权从 0 到 1 等距 21 个采样点，按 weight 升序 */
  points: SensitivityPoint[];
  /** 连续收敛点序列中首次跨过 0.5 的区间；振荡/未收敛点不参与判断 */
  thresholdBand: SensitivityThresholdBand | null;
}

export interface SensitivityRequest {
  edgeId: string;
  targetNodeId: string;
  options?: PropagateOptions;
  /**
   * 可选的当前画布图。提供时扫描在该图的内存副本上进行，不写入 SQLite；
   * 不提供时使用服务端当前持久化的图。
   */
  graph?: GraphDocument;
}
