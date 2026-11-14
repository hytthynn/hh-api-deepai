import type { CSSProperties, ReactElement } from 'react';

export type IconName =
  | 'overview'
  | 'accounts'
  | 'keys'
  | 'models'
  | 'logs'
  | 'stats'
  | 'settings'
  | 'plus'
  | 'refresh'
  | 'trash'
  | 'copy'
  | 'close'
  | 'alert'
  | 'logout'
  | 'search'
  | 'check'
  | 'play'
  | 'chevron-left'
  | 'chevron-right';

const PATHS: Record<IconName, ReactElement> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  accounts: (
    <>
      <circle cx="9" cy="7.5" r="3.2" />
      <path d="M2.8 20c0-3.5 2.8-5.8 6.2-5.8s6.2 2.3 6.2 5.8" />
      <path d="M16.8 8.6a3 3 0 0 1 0 5.4" />
      <path d="M18 14.6c2 .7 3.2 2.3 3.2 4.4" />
    </>
  ),
  keys: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.9 12.2 20 3" />
      <path d="M17 6l2 2" />
      <path d="M14.4 8.6l2 2" />
    </>
  ),
  models: (
    <>
      <path d="M12 2.8 21 7.4v9.2L12 21.2 3 16.6V7.4z" />
      <path d="M3 7.4 12 12l9-4.6" />
      <path d="M12 12v9.2" />
    </>
  ),
  logs: (
    <>
      <path d="M5 5h14" />
      <path d="M5 12h10" />
      <path d="M5 19h13" />
      <path d="M2 5h.01M2 12h.01M2 19h.01" />
    </>
  ),
  stats: (
    <>
      <path d="M4 20V13" />
      <path d="M10 20V5" />
      <path d="M16 20v-9" />
      <path d="M2.5 20h19" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v4.2h-4.2" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4.8h6V7" />
      <path d="M6.5 7 7.5 20h9L17.5 7" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  alert: (
    <>
      <path d="M12 4 2.6 20h18.8z" />
      <path d="M12 10v4" />
      <path d="M12 17.2h.01" />
    </>
  ),
  logout: (
    <>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h10" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.6-3.6" />
    </>
  ),
  check: <path d="M5 12.5 9.5 17 19 7" />,
  play: <path d="M8 5l11 7-11 7z" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
};

export function Icon({
  name,
  size = 16,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}