const paths = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9v12h14V9" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V4M4 20h16" />
      <path d="M8.5 16v-4M13 16V8M17.5 16v-6" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  scan: (
    <>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <path d="M7 12h10" />
    </>
  ),
  contacts: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5" />
      <path d="M16 4.2a4 4 0 0 1 0 7.6M18 14.8c2.4.7 4 2.9 4 6.2" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 21v-4h6v4M8.5 7.5h.01M12 7.5h.01M15.5 7.5h.01M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8.5V20l-4-2v-4.5L3 5Z" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6.5L21 7" />
    </>
  ),
  heart: (
    <path d="M12 20.5S3 15.3 3 8.8A4.8 4.8 0 0 1 12 6.5a4.8 4.8 0 0 1 9 2.3c0 6.5-9 11.7-9 11.7Z" />
  ),
  users: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4 6v6c0 4.6 3.2 7.7 8 9 4.8-1.3 8-4.4 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
};

export type IconName = keyof typeof paths;

/** Trazos propios: evita sumar una dependencia para una docena de íconos. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
