'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from './icons';

/* ---------------- Button ---------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    variant === 'primary' ? 'btn-primary' : variant === 'ghost' ? 'btn-ghost' : variant === 'danger' ? 'btn-danger' : 'btn-secondary',
    size === 'sm' ? 'btn-sm' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <span className="faint">…</span> : children}
    </button>
  );
}

/* ---------------- Field ---------------- */

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="field-error">{error}</span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

/* ---------------- Badge ---------------- */

const STATUS_LABEL: Record<string, string> = {
  active: 'active',
  cooldown: 'cooldown',
  exhausted: 'exhausted',
  dead: 'dead',
  pending: 'pending',
  disabled: 'off',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Badge({ tone = 'info', children }: { tone?: 'info' | 'active' | 'cooldown' | 'dead'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/* ---------------- Switch ---------------- */

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

/* ---------------- Progress ---------------- */

export function Progress({ value, total }: { value: number; total: number }) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
  return (
    <div className="row" style={{ gap: 12 }}>
      <div className="progress" style={{ flex: 1 }} role="progressbar" aria-valuenow={value} aria-valuemax={total}>
        <span style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <span className="mono small muted" style={{ minWidth: 64, textAlign: 'right' }}>
        {value}/{total}
      </span>
    </div>
  );
}

/* ---------------- Modal ---------------- */

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal${wide ? ' modal-lg' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" size={14} />
          </button>
        </div>
        {children}
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ---------------- States ---------------- */

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {hint ? <div className="small">{hint}</div> : null}
      {action}
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-panel" role="alert">
      <div className="error-panel-text">
        <span className="error-panel-title">Ошибка</span>
        <span className="error-panel-message">{message}</span>
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Повторить
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ rows = 5, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div className="stack-8" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="cards" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card">
          <div className="skeleton skeleton-line" style={{ width: '40%' }} />
          <div className="skeleton" style={{ height: 28, marginTop: 12, width: '60%' }} />
        </div>
      ))}
    </div>
  );
}

/* ---------------- Copy ---------------- */

export function CopyButton({ text, label = 'Скопировать' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    setDone(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1_500);
  }, [text]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <Button size="sm" variant="secondary" onClick={() => void copy()}>
      <Icon name={done ? 'check' : 'copy'} size={14} />
      {done ? 'Скопировано' : label}
    </Button>
  );
}

/* ---------------- Segmented ---------------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'active' : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}