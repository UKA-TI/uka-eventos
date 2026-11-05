import type { ReactNode } from 'react';

export function Loading() {
  return (
    <div className="loading" role="status">
      Cargando…
    </div>
  );
}

export function Notice({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'ok';
  children: ReactNode;
}) {
  if (!children) {
    return null;
  }
  return (
    <p
      className={`notice ${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      {children}
    </p>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className={error ? 'field field-invalid' : 'field'}>
      <span>{label}</span>
      {children}
      {hint && !error && <small className="hint">{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const statusLabels: Record<string, [string, string]> = {
  draft: ['Borrador', 'neutral'],
  active: ['Activo', 'ok'],
  closed: ['Cerrado', 'neutral'],
  invited: ['Invitado', 'warn'],
  inactive: ['Desactivado', 'bad'],
};

export function StatusBadge({ status }: { status: string }) {
  const [label, tone] = statusLabels[status] ?? [status, 'neutral'];
  return <span className={`badge ${tone}`}>{label}</span>;
}
