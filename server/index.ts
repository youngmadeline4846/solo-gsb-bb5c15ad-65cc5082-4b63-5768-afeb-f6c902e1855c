import express from 'express';
import cors from 'cors';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createGraphStore } from './db.js';
import {
  propagateBeliefs,
  scanEdgeWeightSensitivity,
  validateGraphDocument,
  validateOptions
} from './propagation.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, '../..');
const port = Number(process.env.PORT ?? 8080);
const databasePath = resolve(projectRoot, process.env.DATABASE_PATH ?? './data/argument.db');
const staticDirectory = resolve(projectRoot, 'dist');

const store = createGraphStore(databasePath);
const app = express();

app.use(cors());
app.use(express.json({ limit: '8mb' }));

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, database: databasePath });
});

app.get('/api/graph', (_request, response) => {
  response.json({ graph: store.getGraph() });
});

app.put('/api/graph', (request, response) => {
  try {
    // 同时接受完整 GraphDocument 与 { graph: GraphDocument }。
    const candidate = request.body?.graph ?? request.body;
    const graph = validateGraphDocument(candidate);
    const saved = store.replaceGraph(graph);
    response.json({ graph: saved });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : '无效图数据。' });
  }
});

app.post('/api/propagate', (request, response) => {
  try {
    const options = validateOptions(request.body?.options ?? request.body);
    const result = propagateBeliefs(store.getGraph(), options);
    response.json({ result });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : '传播参数无效。' });
  }
});

app.post('/api/sensitivity', (request, response) => {
  try {
    const body = request.body ?? {};
    if (typeof body.edgeId !== 'string' || !body.edgeId.trim()) {
      throw new Error('缺少要扫描的连线 edgeId。');
    }
    if (typeof body.targetNodeId !== 'string' || !body.targetNodeId.trim()) {
      throw new Error('缺少目标节点 targetNodeId。');
    }
    // 请求可携带当前画布图：扫描只在内存副本上进行，绝不写入 SQLite。
    // 未携带时退回当前持久化图。
    const graph = body.graph ? validateGraphDocument(body.graph) : store.getGraph();
    const options = validateOptions(body.options);
    const sensitivity = scanEdgeWeightSensitivity(
      graph,
      body.edgeId.trim(),
      body.targetNodeId.trim(),
      options
    );
    response.json({ sensitivity });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : '边权扫描请求无效。' });
  }
});

if (existsSync(staticDirectory)) {
  app.use(express.static(staticDirectory));
  app.get('*', (_request, response) => response.sendFile(resolve(staticDirectory, 'index.html')));
}

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`论证稳定性沙盘已启动: http://localhost:${port}`);
  console.log(`SQLite 数据库: ${databasePath}`);
});

const shutdown = () => {
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
