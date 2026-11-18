import React from 'react';

const P = {
  plane: <><path d="M2 16l20-6-20-6 3 6-3 6z" /><path d="M5 10h8" /></>,
  metro: <><rect x="5" y="3" width="14" height="14" rx="3" /><path d="M5 11h14M8 21l2-4M16 21l-2-4" /></>,
  train: <><rect x="6" y="3" width="12" height="13" rx="2" /><path d="M6 10h12M9 16v4M15 16v4M9 20l-2 2M15 20l2 2" /></>,
  road: <path d="M7 21L10 3M17 21L14 3M12 6v2M12 11v2M12 16v2" />,
  school: <><path d="M2 9l10-5 10 5-10 5z" /><path d="M6 11v5c3 2 9 2 12 0v-5" /></>,
  health: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8M8 12h8" /></>,
  park: <><path d="M12 3l5 8h-3l4 6H6l4-6H7z" /><path d="M12 17v4" /></>,
  shop: <><path d="M5 8h14l-1 12H6z" /><path d="M9 8a3 3 0 016 0" /></>,
  water: <path d="M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z" />,
  build: <><rect x="4" y="9" width="7" height="12" /><rect x="11" y="3" width="9" height="18" /><path d="M14 7h3M14 11h3M14 15h3" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  share: <><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 14v6h14v-6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" />,
  download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 20h14" /></>,
  compare: <><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" /></>,
  pin: <><path d="M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
};

export function Icon({ name, size = 18, className }) {
  return (
    <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{P[name]}</svg>
  );
}
