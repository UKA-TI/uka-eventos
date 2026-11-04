import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  seatingAddTablesSchema,
  seatingAutoResultSchema,
  seatingPublishResultSchema,
  seatingViewSchema,
  type EventDetail,
  type SeatingView,
} from '@uka/shared';
import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type PointerEvent,
} from 'react';
import { z } from 'zod';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Loading, Notice } from '../components/ui.js';
import { issuesToErrors } from './text.js';

type Table = SeatingView['tables'][number];
type Group = SeatingView['groups'][number];
type Warning = z.infer<typeof seatingAutoResultSchema>['warnings'][number];

/** Lo que se arrastra: un grupo completo o una persona. */
type Dragged =
  | { kind: 'group'; orderIds: string[]; label: string }
  | { kind: 'person'; registrationId: string; label: string };

const clamp = (value: number) => Math.min(Math.max(value, 2), 98);

function tableTone(table: Table): string {
  if (table.occupied === 0) {
    return 'empty';
  }
  return table.occupied >= table.capacity ? 'full' : 'partial';
}

export function EventSeatingTab({ event }: { event: EventDetail }) {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const canManage = can('seating.manage');
  const base = `/api/events/${event.id}/seating`;
  const key = ['seating', event.id];
  const planArea = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [newTables, setNewTables] = useState({
    count: '10',
    capacity: '10',
    zone: '',
  });
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();

  const view = useQuery({
    queryKey: key,
    queryFn: async () => seatingViewSchema.parse(await apiRequest(`${base}/`)),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: key });
  };
  const fail = (error: unknown) =>
    setNotice({
      kind: 'error',
      text: errorText(error, 'No se pudo completar la acción.'),
    });

  const send = useMutation({
    mutationFn: async (action: {
      path: string;
      method?: 'POST' | 'PUT' | 'DELETE';
      body?: unknown;
      success?: string;
    }) => {
      await apiRequest(
        `${base}/${action.path}`,
        jsonRequest(action.method ?? 'POST', action.body, csrfToken),
      );
      return action.success;
    },
    onSuccess: async (success) => {
      await refresh();
      if (success) {
        setNotice({ kind: 'ok', text: success });
      }
    },
    onError: fail,
  });

  const auto = useMutation({
    mutationFn: async () =>
      seatingAutoResultSchema.parse(
        await apiRequest(
          `${base}/auto`,
          jsonRequest('POST', undefined, csrfToken),
        ),
      ),
    onSuccess: async (result) => {
      await refresh();
      setWarnings(result.warnings);
      setNotice({
        kind: 'ok',
        text:
          result.unplacedSeats > 0
            ? `Se acomodaron ${result.placed} lugares; ${result.unplacedSeats} quedaron sin mesa. Es un borrador: nadie lo ve hasta publicar.`
            : `Se acomodaron ${result.placed} lugares. Es un borrador: nadie lo ve hasta publicar.`,
      });
    },
    onError: fail,
  });

  const publish = useMutation({
    mutationFn: async () =>
      seatingPublishResultSchema.parse(
        await apiRequest(
          `${base}/publish`,
          jsonRequest('POST', undefined, csrfToken),
        ),
      ),
    onSuccess: async (result) => {
      await refresh();
      setNotice({
        kind: 'ok',
        text: `Acomodo publicado. ${result.notified} correos en la cola${
          result.unassigned > 0
            ? `; ${result.unassigned} personas siguen sin mesa`
            : ''
        }.`,
      });
    },
    onError: fail,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      await apiRequest(`${base}/plan`, {
        method: 'PUT',
        headers: { 'Content-Type': file.type, 'X-CSRF-Token': csrfToken },
        body: file,
      });
    },
    onSuccess: async () => {
      await refresh();
      setNotice({ kind: 'ok', text: 'Plano actualizado.' });
    },
    onError: fail,
  });

  if (view.isPending) {
    return <Loading />;
  }
  if (view.isError) {
    return <Notice>{view.error.message}</Notice>;
  }

  const data = view.data;
  const selected = data.tables.find((table) => table.id === selectedId) ?? null;
  const zones = [
    ...new Set(
      data.tables.map((table) => table.zone).filter(Boolean) as string[],
    ),
  ].sort();
  const term = search.trim().toLowerCase();
  const visibleGroups = data.groups.filter(
    (group) =>
      !term ||
      group.label.toLowerCase().includes(term) ||
      group.orders.some((order) =>
        order.people.some((person) => person.name.toLowerCase().includes(term)),
      ),
  );
  const pendingSeats = data.groups.reduce(
    (sum, group) => sum + group.seats - group.placedSeats,
    0,
  );
  const totalSeats = data.groups.reduce((sum, group) => sum + group.seats, 0);
  const totalCapacity = data.tables.reduce(
    (sum, table) => sum + table.capacity,
    0,
  );

  const position = (table: Table) =>
    positions[table.id] ?? { x: table.x, y: table.y };

  const onPick = (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0];
    change.target.value = '';
    if (!file) {
      return;
    }
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setNotice({ kind: 'error', text: 'El plano debe ser PNG o JPG.' });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setNotice({ kind: 'error', text: 'El plano no debe pasar de 8 MB.' });
      return;
    }
    setNotice(undefined);
    upload.mutate(file);
  };

  const addTables = (submit: FormEvent) => {
    submit.preventDefault();
    const parsed = seatingAddTablesSchema.safeParse({
      count: Number(newTables.count),
      capacity: Number(newTables.capacity),
      zone: newTables.zone.trim() || null,
    });
    if (!parsed.success) {
      setAddErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setAddErrors({});
    setNotice(undefined);
    send.mutate(
      {
        path: 'tables',
        body: parsed.data,
        success: `Se agregaron ${parsed.data.count} mesas. Arrástralas a su lugar.`,
      },
      { onSuccess: () => setAdding(false) },
    );
  };

  /** Arrastrar una mesa por el plano: se guarda al soltar, en porcentaje del plano. */
  const startMove = (down: PointerEvent<HTMLButtonElement>, table: Table) => {
    if (!canManage || !planArea.current) {
      return;
    }
    const area = planArea.current.getBoundingClientRect();
    const element = down.currentTarget;
    const startX = down.clientX;
    const startY = down.clientY;
    element.setPointerCapture(down.pointerId);
    let moved = false;
    let last = position(table);
    const onMove = (move: globalThis.PointerEvent) => {
      if (Math.hypot(move.clientX - startX, move.clientY - startY) < 4) {
        return;
      }
      moved = true;
      last = {
        x: clamp(((move.clientX - area.left) / area.width) * 100),
        y: clamp(((move.clientY - area.top) / area.height) * 100),
      };
      setPositions((current) => ({ ...current, [table.id]: last }));
    };
    const onUp = () => {
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      if (moved) {
        send.mutate({
          path: `tables/${table.id}`,
          method: 'PUT',
          body: {
            name: table.name,
            capacity: table.capacity,
            zone: table.zone,
            x: last.x,
            y: last.y,
          },
        });
      } else {
        setSelectedId(table.id);
      }
    };
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
  };

  const seatGroup = (group: Group, tableId: string | null) => {
    setNotice(undefined);
    send.mutate({
      path: 'move-group',
      body: { orderIds: group.orders.map((order) => order.id), tableId },
    });
  };
  const seatPerson = (registrationId: string, tableId: string | null) => {
    setNotice(undefined);
    send.mutate({ path: 'move-person', body: { registrationId, tableId } });
  };

  const dropOn = (drop: DragEvent, tableId: string) => {
    drop.preventDefault();
    setDropTarget(null);
    if (!dragged) {
      return;
    }
    setNotice(undefined);
    if (dragged.kind === 'group') {
      send.mutate({
        path: 'move-group',
        body: { orderIds: dragged.orderIds, tableId },
      });
    } else {
      seatPerson(dragged.registrationId, tableId);
    }
    setDragged(null);
  };

  const publishNow = () => {
    const missing =
      pendingSeats > 0
        ? ` ${pendingSeats} lugares siguen sin mesa y no recibirán aviso.`
        : '';
    if (
      window.confirm(
        `Se avisará por correo a ${data.pendingChanges} personas con su mesa y su pase.${missing} ¿Publicar?`,
      )
    ) {
      setNotice(undefined);
      publish.mutate();
    }
  };

  return (
    <>
      <div className="seating-print">
        <h1>{event.name}: lista por mesa</h1>
        {data.tables.map((table) => (
          <section key={table.id}>
            <h2>
              {table.name}
              {table.zone ? ` · ${table.zone}` : ''} ({table.occupied} de{' '}
              {table.capacity})
            </h2>
            <ol>
              {table.people.map((person) => (
                <li key={person.id}>
                  {person.name} · {person.folio} · {person.group}
                </li>
              ))}
            </ol>
            {table.occupied > table.people.length && (
              <p>
                {table.occupied - table.people.length} lugares apartados, aún
                sin registrar.
              </p>
            )}
          </section>
        ))}
      </div>

      <div className="seating-screen">
        <div className="seating-bar">
          <div className="seating-status">
            {data.publishedAt ? (
              <span className="badge ok">
                Publicado el{' '}
                {new Date(data.publishedAt).toLocaleDateString('es-MX', {
                  dateStyle: 'medium',
                })}
              </span>
            ) : (
              <span className="badge warn">Borrador: nadie lo ve aún</span>
            )}
            {data.publishedAt && data.pendingChanges > 0 && (
              <span className="badge warn">
                {data.pendingChanges} cambios sin publicar
              </span>
            )}
            <small>
              {totalSeats - pendingSeats} de {totalSeats} lugares acomodados ·{' '}
              {totalCapacity} de cupo en {data.tables.length} mesas
            </small>
          </div>
          <div className="heading-actions">
            <button
              className="button secondary small"
              type="button"
              onClick={() => window.print()}
            >
              Imprimir lista
            </button>
            {canManage && (
              <>
                <button
                  className="button secondary small"
                  type="button"
                  disabled={auto.isPending || data.tables.length === 0}
                  onClick={() => {
                    setNotice(undefined);
                    auto.mutate();
                  }}
                >
                  {auto.isPending ? 'Acomodando…' : 'Acomodo automático'}
                </button>
                <button
                  className="button primary small"
                  type="button"
                  disabled={publish.isPending || data.pendingChanges === 0}
                  onClick={publishNow}
                >
                  Publicar y avisar
                </button>
              </>
            )}
          </div>
        </div>

        {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
        {data.unpaidSeats > 0 && (
          <p className="notice warn" role="status">
            {data.unpaidSeats} lugares con pago pendiente no se acomodan hasta
            que se confirme su pago.
          </p>
        )}
        {warnings.length > 0 && (
          <div className="checklist" role="status">
            <strong>Revisa estos grupos:</strong>
            <ul>
              {warnings.map((warning) => (
                <li key={`${warning.groupKey}-${warning.kind}`}>
                  <b>{warning.label}:</b> {warning.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="seating-grid">
          <aside className="panel seating-groups">
            <div className="panel-heading">
              <h2>Grupos</h2>
            </div>
            <input
              className="note-input"
              type="search"
              placeholder="Buscar empresa o persona"
              aria-label="Buscar grupo o persona"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {data.groups.length === 0 && (
              <p className="muted">Aún no hay compras confirmadas.</p>
            )}
            <ul className="group-list">
              {visibleGroups.map((group) => {
                const missing = group.seats - group.placedSeats;
                const tables = [
                  ...new Set(
                    group.orders.flatMap((order) =>
                      order.allocations.map((item) => item.tableName),
                    ),
                  ),
                ];
                const isLocked = group.orders.some((order) =>
                  order.allocations.some((item) => item.locked),
                );
                const open = openGroup === group.key;
                return (
                  <li
                    key={group.key}
                    className={
                      missing > 0 ? 'group-card waiting' : 'group-card'
                    }
                    draggable={canManage}
                    onDragStart={() =>
                      setDragged({
                        kind: 'group',
                        orderIds: group.orders.map((order) => order.id),
                        label: group.label,
                      })
                    }
                    onDragEnd={() => setDragged(null)}
                  >
                    <button
                      className="group-title"
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenGroup(open ? null : group.key)}
                    >
                      <strong>{group.label}</strong>
                      <small>
                        {group.seats} {group.seats === 1 ? 'lugar' : 'lugares'}
                        {tables.length > 0 ? ` · ${tables.join(', ')}` : ''}
                        {missing > 0 && tables.length > 0
                          ? ` · faltan ${missing}`
                          : ''}
                        {tables.length === 0 ? ' · sin mesa' : ''}
                        {isLocked ? ' · fijo' : ''}
                      </small>
                    </button>
                    {open && (
                      <div className="group-detail">
                        {canManage && (
                          <>
                            <label className="field">
                              <span>Mover todo el grupo a</span>
                              <select
                                value=""
                                onChange={(e) =>
                                  seatGroup(group, e.target.value || null)
                                }
                              >
                                <option value="">Elegir mesa…</option>
                                {data.tables.map((table) => (
                                  <option key={table.id} value={table.id}>
                                    {table.name} ·{' '}
                                    {table.capacity - table.occupied} libres
                                  </option>
                                ))}
                              </select>
                            </label>
                            {zones.length > 0 && (
                              <label className="field">
                                <span>Reservar en zona</span>
                                <select
                                  value={group.zone ?? ''}
                                  onChange={(e) =>
                                    send.mutate({
                                      path: 'groups/zone',
                                      method: 'PUT',
                                      body: {
                                        groupKey: group.key,
                                        zone: e.target.value || null,
                                      },
                                    })
                                  }
                                >
                                  <option value="">Sin zona</option>
                                  {zones.map((zone) => (
                                    <option key={zone} value={zone}>
                                      {zone}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                          </>
                        )}
                        {group.orders.flatMap((order) =>
                          order.allocations.map((item) => (
                            <div className="allocation" key={item.id}>
                              <span>
                                {item.tableName}: {item.seats}{' '}
                                {item.seats === 1 ? 'lugar' : 'lugares'}
                              </span>
                              {canManage && (
                                <button
                                  className="link-button"
                                  type="button"
                                  onClick={() =>
                                    send.mutate({
                                      path: `allocations/${item.id}/lock`,
                                      body: { locked: !item.locked },
                                    })
                                  }
                                >
                                  {item.locked ? 'Soltar' : 'Fijar'}
                                </button>
                              )}
                            </div>
                          )),
                        )}
                        <ul className="people-list">
                          {group.orders.flatMap((order) =>
                            order.people.map((person) => (
                              <li
                                key={person.id}
                                draggable={canManage}
                                onDragStart={(start) => {
                                  start.stopPropagation();
                                  setDragged({
                                    kind: 'person',
                                    registrationId: person.id,
                                    label: person.name,
                                  });
                                }}
                              >
                                <span>
                                  {person.name}
                                  <small>
                                    {person.folio}
                                    {person.pendingActivation
                                      ? ' · sin activar'
                                      : ''}
                                  </small>
                                </span>
                                {canManage && (
                                  <select
                                    aria-label={`Mesa de ${person.name}`}
                                    value={person.tableId ?? ''}
                                    onChange={(e) =>
                                      seatPerson(
                                        person.id,
                                        e.target.value || null,
                                      )
                                    }
                                  >
                                    <option value="">Sin mesa</option>
                                    {data.tables.map((table) => (
                                      <option key={table.id} value={table.id}>
                                        {table.name}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </li>
                            )),
                          )}
                          {group.orders.reduce(
                            (sum, order) =>
                              sum + order.seats - order.people.length,
                            0,
                          ) > 0 && (
                            <li className="unregistered">
                              <small>
                                {group.orders.reduce(
                                  (sum, order) =>
                                    sum + order.seats - order.people.length,
                                  0,
                                )}{' '}
                                lugares aún sin registrar: quedan apartados en
                                su mesa.
                              </small>
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </aside>

          <div className="seating-main">
            {canManage && (
              <div className="seating-tools">
                <label className="button secondary small">
                  {data.planVersion
                    ? 'Cambiar plano'
                    : 'Subir plano (PNG o JPG)'}
                  <input
                    className="visually-hidden"
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={onPick}
                  />
                </label>
                {!adding && (
                  <button
                    className="button secondary small"
                    type="button"
                    onClick={() => setAdding(true)}
                  >
                    Agregar mesas
                  </button>
                )}
              </div>
            )}
            {adding && (
              <form className="inner-form" onSubmit={addTables} noValidate>
                <div className="form-grid">
                  <Field label="Cuántas mesas" error={addErrors.count}>
                    <input
                      type="number"
                      value={newTables.count}
                      onChange={(e) =>
                        setNewTables({ ...newTables, count: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Lugares por mesa" error={addErrors.capacity}>
                    <input
                      type="number"
                      value={newTables.capacity}
                      onChange={(e) =>
                        setNewTables({
                          ...newTables,
                          capacity: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="Zona (opcional)"
                    error={addErrors.zone}
                    hint="Por ejemplo: VIP o Escenario."
                  >
                    <input
                      value={newTables.zone}
                      onChange={(e) =>
                        setNewTables({ ...newTables, zone: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <div className="form-actions">
                  <button className="button primary small" type="submit">
                    Agregar
                  </button>
                  <button
                    className="button secondary small"
                    type="button"
                    onClick={() => setAdding(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            <div
              className={data.planVersion ? 'plan-area' : 'plan-area blank'}
              ref={planArea}
            >
              {data.planVersion ? (
                <img
                  src={`${base}/plan?v=${data.planVersion}`}
                  alt={`Plano de ${event.venue ?? 'la sede'}`}
                  draggable={false}
                />
              ) : (
                data.tables.length === 0 && (
                  <p className="muted">
                    Sube el plano de la sede y agrega las mesas para colocarlas
                    encima. También puedes trabajar sin plano.
                  </p>
                )
              )}
              {data.tables.map((table) => {
                const at = position(table);
                return (
                  <button
                    key={table.id}
                    type="button"
                    className={[
                      'table-node',
                      tableTone(table),
                      table.zone ? 'zoned' : '',
                      selectedId === table.id ? 'selected' : '',
                      dropTarget === table.id ? 'drop' : '',
                    ].join(' ')}
                    style={{ left: `${at.x}%`, top: `${at.y}%` }}
                    title={`${table.name}: ${table.occupied} de ${table.capacity}${table.zone ? ` · ${table.zone}` : ''}`}
                    onPointerDown={(down) => startMove(down, table)}
                    onClick={() => setSelectedId(table.id)}
                    onDragOver={(over) => {
                      over.preventDefault();
                      setDropTarget(table.id);
                    }}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={(drop) => dropOn(drop, table.id)}
                  >
                    <b>{table.name.replace(/^Mesa /, '')}</b>
                    <small>
                      {table.occupied}/{table.capacity}
                    </small>
                  </button>
                );
              })}
            </div>

            <div className="plan-legend" aria-hidden="true">
              <span>
                <i className="empty" /> Vacía
              </span>
              <span>
                <i className="partial" /> Con lugar
              </span>
              <span>
                <i className="full" /> Llena
              </span>
              <span>
                <i className="zoned" /> Con zona
              </span>
            </div>

            {selected && (
              <TableDetail
                key={`${selected.id}-${selected.capacity}-${selected.name}-${selected.zone}`}
                table={selected}
                canManage={canManage}
                position={position(selected)}
                onClose={() => setSelectedId(null)}
                onSave={(body) =>
                  send.mutate({
                    path: `tables/${selected.id}`,
                    method: 'PUT',
                    body,
                    success: 'Mesa actualizada.',
                  })
                }
                onDelete={() => {
                  if (window.confirm(`¿Borrar ${selected.name}?`)) {
                    setSelectedId(null);
                    send.mutate({
                      path: `tables/${selected.id}`,
                      method: 'DELETE',
                      success: 'Mesa borrada.',
                    });
                  }
                }}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function TableDetail({
  table,
  canManage,
  position,
  onClose,
  onSave,
  onDelete,
}: {
  table: Table;
  canManage: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  onSave: (body: unknown) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(table.name);
  const [capacity, setCapacity] = useState(String(table.capacity));
  const [zone, setZone] = useState(table.zone ?? '');

  return (
    <div className="panel table-detail">
      <div className="panel-heading">
        <h2>
          {table.name}: {table.occupied} de {table.capacity}
        </h2>
        <button className="link-button" type="button" onClick={onClose}>
          Cerrar
        </button>
      </div>
      {canManage && (
        <form
          className="inline-form"
          onSubmit={(submit) => {
            submit.preventDefault();
            onSave({
              name: name.trim(),
              capacity: Number(capacity),
              zone: zone.trim() || null,
              x: position.x,
              y: position.y,
            });
          }}
        >
          <Field label="Nombre">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Lugares">
            <input
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </Field>
          <Field label="Zona">
            <input value={zone} onChange={(e) => setZone(e.target.value)} />
          </Field>
          <button className="button secondary small" type="submit">
            Guardar
          </button>
          {table.occupied === 0 && (
            <button
              className="button danger small"
              type="button"
              onClick={onDelete}
            >
              Borrar
            </button>
          )}
        </form>
      )}
      {table.people.length === 0 ? (
        <p className="muted">
          {table.occupied > 0
            ? `${table.occupied} lugares apartados, aún sin personas registradas.`
            : 'Mesa vacía.'}
        </p>
      ) : (
        <ul className="plain-list">
          {table.people.map((person) => (
            <li key={person.id}>
              <span>
                {person.name}
                <small>
                  {person.folio} · {person.group}
                </small>
              </span>
            </li>
          ))}
          {table.occupied > table.people.length && (
            <li>
              <small className="muted">
                {table.occupied - table.people.length} lugares apartados, aún
                sin registrar.
              </small>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
