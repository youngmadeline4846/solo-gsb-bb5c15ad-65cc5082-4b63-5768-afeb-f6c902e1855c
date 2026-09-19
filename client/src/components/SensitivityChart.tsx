import { useState } from 'react';
import type { EdgeWeightSensitivity, SensitivityPoint, SensitivityStatus } from '../../../shared/graph';

interface SensitivityChartProps {
  sensitivity: EdgeWeightSensitivity;
}

const WIDTH = 470;
const HEIGHT = 300;
const MARGIN = { top: 18, right: 20, bottom: 56, left: 46 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_TOP = MARGIN.top;
const PLOT_BOTTOM = 238;
const PLOT_H = PLOT_BOTTOM - PLOT_TOP;
const NULL_ROW_Y = 264;

const STATUS_TEXT: Record<SensitivityStatus, string> = {
  converged: '收敛',
  oscillating: '振荡',
  limit: '达到上限'
};

const STATUS_COLOR: Record<SensitivityStatus, string> = {
  converged: '#16a34a',
  oscillating: '#dc2626',
  limit: '#d97706'
};

const xOf = (weight: number) => MARGIN.left + weight * PLOT_W;
const yOf = (value: number) => PLOT_BOTTOM - value * PLOT_H;

/** 振荡/未收敛点没有目标值，统一绘在曲线下方的独立标记行。 */
function Marker({ point, hovered, onEnter, onLeave }: {
  point: SensitivityPoint;
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const cx = xOf(point.weight);
  const cy = point.status === 'converged' && point.targetValue !== null ? yOf(point.targetValue) : NULL_ROW_Y;
  const color = STATUS_COLOR[point.status];
  const common = {
    cursor: 'pointer' as const,
    onMouseEnter: onEnter,
    onMouseLeave: onLeave
  };
  if (point.status === 'converged') {
    return <circle cx={cx} cy={cy} r={hovered ? 7 : 5} fill={color} stroke="#fff" strokeWidth={1.5} {...common} />;
  }
  if (point.status === 'oscillating') {
    const size = hovered ? 13 : 10;
    return (
      <rect
        x={cx - size / 2}
        y={cy - size / 2}
        width={size}
        height={size}
        rx={1.5}
        fill={color}
        stroke="#fff"
        strokeWidth={1.5}
        transform={`rotate(45 ${cx} ${cy})`}
        {...common}
      />
    );
  }
  const size = hovered ? 13 : 10;
  return (
    <rect
      x={cx - size / 2}
      y={cy - size / 2}
      width={size}
      height={size}
      rx={1.5}
      fill={color}
      stroke="#fff"
      strokeWidth={1.5}
      {...common}
    />
  );
}

/**
 * 边权敏感性曲线：
 * - 仅把连续的收敛点连成曲线；
 * - 振荡点（菱形）与达到上限点（方块）没有目标值，标在下方独立行；
 * - 首次跨过 0.5 的连续采样区间高亮为阈值带。
 */
export function SensitivityChart({ sensitivity }: SensitivityChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const { points, thresholdBand, edge } = sensitivity;
  const convergedCount = points.filter((point) => point.status === 'converged').length;
  const oscillatingCount = points.filter((point) => point.status === 'oscillating').length;
  const limitCount = points.length - convergedCount - oscillatingCount;

  // 按连续性把收敛点拆成若干段，分别连线（被非收敛点打断即另起一段）。
  const segments: string[] = [];
  let currentPath = '';
  points.forEach((point, index) => {
    if (point.status === 'converged' && point.targetValue !== null) {
      const command = currentPath ? 'L' : 'M';
      currentPath += `${command}${xOf(point.weight).toFixed(2)},${yOf(point.targetValue).toFixed(2)} `;
    } else if (currentPath) {
      segments.push(currentPath.trim());
      currentPath = '';
    }
    if (index === points.length - 1 && currentPath) segments.push(currentPath.trim());
  });

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const xTicks = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverX = hovered ? xOf(hovered.weight) : 0;
  // 气泡宽约 170px：以悬停点为中心，并夹在绘图区内避免左右溢出。
  const tooltipBubbleWidth = 172;
  const tooltipLeftPx = Math.min(
    WIDTH - MARGIN.right - tooltipBubbleWidth,
    Math.max(MARGIN.left, hoverX - tooltipBubbleWidth / 2)
  );
  const tooltipLeft = `${(tooltipLeftPx / WIDTH) * 100}%`;

  return (
    <div className="sensitivity-chart">
      <div className="sensitivity-legend">
        <span><i className="legend-dot converged" />收敛（{convergedCount}）</span>
        <span><i className="legend-diamond" />振荡（{oscillatingCount}）</span>
        <span><i className="legend-square" />达到上限（{limitCount}）</span>
      </div>
      <div className="sensitivity-plot">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="边权敏感性曲线">
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={WIDTH - MARGIN.right}
                y1={yOf(tick)}
                y2={yOf(tick)}
                stroke={tick === 0.5 ? '#f59e0b' : '#e2e8f0'}
                strokeWidth={tick === 0.5 ? 1.5 : 1}
                strokeDasharray={tick === 0.5 ? '6 4' : undefined}
              />
              <text x={MARGIN.left - 8} y={yOf(tick) + 4} textAnchor="end" fontSize={11} fill="#64748b">
                {tick.toFixed(2)}
              </text>
              {tick === 0.5 && (
                <text x={WIDTH - MARGIN.right} y={yOf(0.5) - 6} textAnchor="end" fontSize={11} fill="#b45309">
                  0.5 阈值线
                </text>
              )}
            </g>
          ))}

          {xTicks.map((tick) => (
            <g key={tick}>
              <line x1={xOf(tick)} x2={xOf(tick)} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM + 5} stroke="#94a3b8" />
              <text x={xOf(tick)} y={PLOT_BOTTOM + 19} textAnchor="middle" fontSize={11} fill="#64748b">
                {tick.toFixed(1)}
              </text>
            </g>
          ))}
          <text x={MARGIN.left + PLOT_W / 2} y={PLOT_BOTTOM + 38} textAnchor="middle" fontSize={12} fill="#475569">
            边权 w
          </text>

          {/* 非收敛点标记行：与曲线区隔开 */}
          <line
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={NULL_ROW_Y - 13}
            y2={NULL_ROW_Y - 13}
            stroke="#cbd5e1"
            strokeDasharray="3 4"
          />
          <text x={MARGIN.left} y={NULL_ROW_Y - 18} fontSize={10} fill="#94a3b8">
            无最终值（悬停查看原因）
          </text>

          {thresholdBand && (
            <g>
              <rect
                x={xOf(thresholdBand.fromWeight)}
                y={PLOT_TOP}
                width={xOf(thresholdBand.toWeight) - xOf(thresholdBand.fromWeight)}
                height={PLOT_H}
                fill="#f59e0b"
                opacity={0.16}
              />
              <line
                x1={xOf(thresholdBand.fromWeight)}
                x2={xOf(thresholdBand.fromWeight)}
                y1={PLOT_TOP}
                y2={NULL_ROW_Y + 12}
                stroke="#d97706"
                strokeWidth={1.5}
              />
              <line
                x1={xOf(thresholdBand.toWeight)}
                x2={xOf(thresholdBand.toWeight)}
                y1={PLOT_TOP}
                y2={NULL_ROW_Y + 12}
                stroke="#d97706"
                strokeWidth={1.5}
              />
            </g>
          )}

          {segments.map((path, index) => (
            <path key={index} d={path} fill="none" stroke="#16a34a" strokeWidth={2} strokeLinejoin="round" />
          ))}

          {/* 扫描使用的是边的内存副本；当前画布上的真实边权以竖线参照标出。 */}
          <line
            x1={xOf(edge.weight)}
            x2={xOf(edge.weight)}
            y1={PLOT_TOP - 4}
            y2={NULL_ROW_Y + 12}
            stroke="#2563eb"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          <text x={xOf(edge.weight)} y={PLOT_TOP - 6} textAnchor="middle" fontSize={10} fill="#1d4ed8">
            当前 {(edge.weight * 100).toFixed(0)}%
          </text>

          {points.map((point, index) => (
            <Marker
              key={point.weight}
              point={point}
              hovered={hoverIndex === index}
              onEnter={() => setHoverIndex(index)}
              onLeave={() => setHoverIndex(null)}
            />
          ))}

          {/* 悬停参考竖线与加宽热区 */}
          {hovered && (
            <line
              x1={hoverX}
              x2={hoverX}
              y1={PLOT_TOP}
              y2={NULL_ROW_Y + 12}
              stroke="#64748b"
              strokeWidth={1}
              strokeDasharray="2 3"
              pointerEvents="none"
            />
          )}
          {points.map((point, index) => {
            const step = PLOT_W / (points.length - 1);
            const half = step / 2 - 0.5;
            return (
              <rect
                key={`hit-${point.weight}`}
                x={MARGIN.left + index * step - half}
                y={PLOT_TOP - 8}
                width={half * 2}
                height={NULL_ROW_Y + 18 - PLOT_TOP}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(index)}
                onMouseLeave={() => setHoverIndex(null)}
              />
            );
          })}
        </svg>

        {hovered && (
          <div className="sensitivity-tooltip" style={{ left: tooltipLeft }}>
            <strong>边权 {(hovered.weight * 100).toFixed(0)}%</strong>
            <span>
              状态：
              <em style={{ color: STATUS_COLOR[hovered.status] }}>{STATUS_TEXT[hovered.status]}</em>
            </span>
            <span>停止轮次：第 {hovered.iterations} 轮</span>
            {hovered.targetValue !== null ? (
              <span>目标值：{hovered.targetValue.toFixed(4)}</span>
            ) : (
              <span className="tooltip-reason">原因：{hovered.reason}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
