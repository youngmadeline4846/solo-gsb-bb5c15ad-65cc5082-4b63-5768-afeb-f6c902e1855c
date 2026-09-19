import type {
  EdgeWeightSensitivity,
  GraphDocument,
  PropagateOptions,
  PropagateResult
} from '../../shared/graph';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `请求失败：${response.status}`);
  return payload as T;
}

export const api = {
  getGraph: () => request<{ graph: GraphDocument }>('/api/graph'),
  saveGraph: (graph: GraphDocument) => request<{ graph: GraphDocument }>('/api/graph', {
    method: 'PUT',
    body: JSON.stringify(graph)
  }),
  propagate: (options: PropagateOptions) =>
    request<{ result: PropagateResult }>('/api/propagate', {
      method: 'POST',
      body: JSON.stringify({ options })
    }),
  scanSensitivity: (params: {
    edgeId: string;
    targetNodeId: string;
    options: PropagateOptions;
    /** 携带当前画布图：服务端在内存副本上扫描，不保存图 */
    graph: GraphDocument;
  }) =>
    request<{ sensitivity: EdgeWeightSensitivity }>('/api/sensitivity', {
      method: 'POST',
      body: JSON.stringify(params)
    })
};
