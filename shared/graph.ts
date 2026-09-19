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
