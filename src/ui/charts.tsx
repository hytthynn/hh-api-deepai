'use client';

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth(next);
    });
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

export type SeriesPoint = { t: number; value: number; secondary?: number };

const PAD = { top: 10, right: 10, bottom: 22, left: 38 };

function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

function timeLabel(ts: number, spanMs: number): string {
  const date = new Date(ts);
  if (spanMs <= 26 * 3_600_000) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function LineChart({
  points,
  height = 180,
  format = (value: number) => String(Math.round(value)),
  label = 'значение',
}: {
  points: SeriesPoint[];
  height?: number;
  format?: (value: number) => string;
  label?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = Math.max(0, height - PAD.top - PAD.bottom);
  const max = niceMax(Math.max(1, ...points.map((point) => Math.max(point.value, point.secondary ?? 0))));
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const x = (index: number): number => PAD.left + (points.length === 1 ? innerW / 2 : index * stepX);
  const y = (value: number): number => PAD.top + innerH - (value / max) * innerH;

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
  const area =
    points.length > 0
      ? `${line} L${x(points.length - 1).toFixed(2)},${(PAD.top + innerH).toFixed(2)} L${x(0).toFixed(2)},${(
          PAD.top + innerH
        ).toFixed(2)} Z`
      : '';

  const spanMs = points.length > 1 ? (points[points.length - 1]!.t - points[0]!.t) || 0 : 0;
  const hovered = hover !== null ? points[hover] : undefined;

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {width > 0 ? (
        <svg
          className="chart"
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label={`График ${label}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            if (points.length === 0) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const mx = event.clientX - rect.left;
            const index = Math.round((mx - PAD.left) / (stepX || 1));
            setHover(Math.min(points.length - 1, Math.max(0, index)));
          }}
        >
          {[0, 0.5, 1].map((ratio) => {
            const gy = PAD.top + innerH * ratio;
            return (
              <g key={ratio}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + innerW}
                  y1={gy}
                  y2={gy}
                  stroke="#1F1F1F"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text x={PAD.left - 6} y={gy + 3} fontSize={10} fill="#5C5C5C" textAnchor="end">
                  {format(max * (1 - ratio))}
                </text>
              </g>
            );
          })}

          {area ? <path d={area} fill="rgba(198,255,61,0.08)" stroke="none" /> : null}
          {line ? <path d={line} fill="none" stroke="#C6FF3D" strokeWidth={1.5} strokeLinejoin="round" /> : null}

          {points.length > 0
            ? [0, Math.floor(points.length / 2), points.length - 1].map((index) => (
                <text
                  key={index}
                  x={x(index)}
                  y={height - 6}
                  fontSize={10}
                  fill="#5C5C5C"
                  textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
                >
                  {timeLabel(points[index]!.t, spanMs)}
                </text>
              ))
            : null}

          {hovered ? (
            <g>
              <line
                x1={x(hover!)}
                x2={x(hover!)}
                y1={PAD.top}
                y2={PAD.top + innerH}
                stroke="#2A2A2A"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
            </g>
          ) : null}
        </svg>
      ) : (
        <div className="skeleton" style={{ height }} />
      )}

      {hovered ? (
        <div
          className="small mono"
          style={{
            position: 'absolute',
            top: 0,
            left: Math.min(Math.max(x(hover!) - 60, 0), Math.max(0, width - 130)),
            width: 120,
            padding: '6px 8px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-elevated)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          <div className="faint">{timeLabel(hovered.t, spanMs)}</div>
          <div>{format(hovered.value)}</div>
          {hovered.secondary !== undefined ? (
            <div style={{ color: 'var(--danger)' }}>{format(hovered.secondary)}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ErrorBars({
  points,
  height = 90,
  format = (value: number) => String(Math.round(value)),
}: {
  points: SeriesPoint[];
  height?: number;
  format?: (value: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = Math.max(0, height - PAD.top - PAD.bottom);
  const max = niceMax(Math.max(1, ...points.map((point) => point.value)));
  const slot = points.length > 0 ? innerW / points.length : 0;
  const barWidth = Math.max(2, Math.min(18, slot * 0.55));

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {width > 0 ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label="Ошибки по интервалам"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            if (points.length === 0) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const index = Math.floor((event.clientX - rect.left - PAD.left) / (slot || 1));
            setHover(Math.min(points.length - 1, Math.max(0, index)));
          }}
        >
          <line
            x1={PAD.left}
            x2={PAD.left + innerW}
            y1={PAD.top + innerH}
            y2={PAD.top + innerH}
            stroke="#1F1F1F"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
          {points.map((point, index) => {
            const barHeight = max > 0 ? (point.value / max) * innerH : 0;
            return (
              <rect
                key={point.t}
                x={PAD.left + index * slot + (slot - barWidth) / 2}
                y={PAD.top + innerH - barHeight}
                width={barWidth}
                height={Math.max(point.value > 0 ? 1 : 0, barHeight)}
                fill="#FF4D4D"
                opacity={hover === null || hover === index ? 1 : 0.5}
              />
            );
          })}
          <text x={PAD.left - 6} y={PAD.top + 8} fontSize={10} fill="#5C5C5C" textAnchor="end">
            {format(max)}
          </text>
        </svg>
      ) : (
        <div className="skeleton" style={{ height }} />
      )}
      {hover !== null && points[hover] ? (
        <div
          className="small mono"
          style={{
            position: 'absolute',
            top: 0,
            left: Math.min(Math.max(PAD.left + hover * slot - 40, 0), Math.max(0, width - 100)),
            padding: '4px 6px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-elevated)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          {format(points[hover]!.value)}
        </div>
      ) : null}
    </div>
  );
}

export type BarItem = { label: string; value: number; caption?: string; error?: boolean };

export function BarList({ items, format = (value: number) => String(Math.round(value)) }: { items: BarItem[]; format?: (value: number) => string }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div>
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.label}>
            {item.label}
          </span>
          <span className="bar-track">
            <span
              className={`bar-fill${item.error ? ' error' : ''}`}
              style={{ width: `${Math.max(item.value > 0 ? 2 : 0, (item.value / max) * 100)}%`, display: 'block' }}
            />
          </span>
          <span className="mono num" title={item.caption}>
            {format(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SparkBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="row" style={{ alignItems: 'flex-end', gap: 2, height: 28 }}>
      {values.map((value, index) => (
        <span
          key={index}
          style={{
            width: 3,
            height: `${Math.max(2, (value / max) * 28)}px`,
            background: value > 0 ? 'var(--lime)' : 'var(--border)',
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}