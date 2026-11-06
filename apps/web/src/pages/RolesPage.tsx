import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  allPermissions,
  permissionCatalog,
  roleResponseSchema,
  type PermissionCode,
  type RoleRecord,
} from '@uka/shared';
import { useState } from 'react';
import { z } from 'zod';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Loading, Notice, PageHeading } from '../components/ui.js';
import { Icon } from '../components/icons.js';
import { ModuleNavigation } from '../components/ModuleNavigation.js';

const roleSections = [
  ['profile', 'Por perfil'],
  ['compare', 'Comparar perfiles'],
] as const;

interface Draft {
  id: string | null;
  name: string;
  description: string;
  permissions: PermissionCode[];
}

const newDraft: Draft = {
  id: null,
  name: '',
  description: '',
  permissions: [],
};

const COMPARE_SLOTS = 3;

const people = (count: number) =>
  `${count} ${count === 1 ? 'persona' : 'personas'}`;

function Mark({ granted }: { granted: boolean }) {
  return (
    <span
      className={granted ? 'mark yes' : 'mark no'}
      aria-label={granted ? 'Permitido' : 'No permitido'}
    >
      {granted ? '✓' : '–'}
    </span>
  );
}

function ProfileDetail({
  role,
  canManage,
  onEdit,
  onRemove,
}: {
  role: RoleRecord;
  canManage: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="panel profile-detail">
      <div className="panel-heading">
        <div>
          <h2>{role.name}</h2>
          <p className="muted">
            {role.description ? `${role.description} ` : ''}
            {people(role.userCount)} · {role.permissions.length} de{' '}
            {allPermissions.length} permisos
          </p>
        </div>
        {canManage &&
          (role.isLocked ? (
            <span className="badge neutral">No editable</span>
          ) : (
            <span className="row-actions">
              <button
                className="button secondary small"
                type="button"
                onClick={onEdit}
              >
                Editar
              </button>
              {!role.isSystem && (
                <button
                  className="button secondary small danger"
                  type="button"
                  onClick={onRemove}
                >
                  Borrar
                </button>
              )}
            </span>
          ))}
      </div>
      <div className="permission-modules">
        {permissionCatalog.map((module) => {
          const granted = module.actions.filter((action) =>
            role.permissions.includes(action.code),
          ).length;
          return (
            <section key={module.key} className="permission-module">
              <h3>
                {module.label}
                <small>
                  {granted} de {module.actions.length}
                </small>
              </h3>
              <ul>
                {module.actions.map((action) => {
                  const has = role.permissions.includes(action.code);
                  return (
                    <li key={action.code} className={has ? '' : 'off'}>
                      <Mark granted={has} />
                      {action.label}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CompareView({ list }: { list: RoleRecord[] }) {
  const [chosen, setChosen] = useState<string[]>(() =>
    list.slice(0, COMPARE_SLOTS).map((role) => role.id),
  );
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const roles = chosen
    .map((id) => list.find((role) => role.id === id))
    .filter((role): role is RoleRecord => Boolean(role));

  const differs = (code: PermissionCode) =>
    new Set(roles.map((role) => role.permissions.includes(code))).size > 1;
  const modules = permissionCatalog
    .map((module) => ({
      ...module,
      visible: module.actions.filter(
        (action) => !onlyDifferences || differs(action.code),
      ),
    }))
    .filter((module) => module.visible.length > 0);

  return (
    <div className="panel table-panel">
      <div className="compare-controls">
        {Array.from({ length: COMPARE_SLOTS }, (_, slot) => (
          <select
            key={slot}
            aria-label={`Perfil ${slot + 1} a comparar`}
            value={chosen[slot] ?? ''}
            onChange={(e) =>
              setChosen((current) =>
                Array.from(
                  { length: COMPARE_SLOTS },
                  (_item, index) =>
                    (index === slot ? e.target.value : current[index]) ?? '',
                ),
              )
            }
          >
            <option value="">Sin perfil</option>
            {list.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        ))}
        <label className="check-field">
          <input
            type="checkbox"
            checked={onlyDifferences}
            onChange={(e) => setOnlyDifferences(e.target.checked)}
          />
          Solo diferencias
        </label>
      </div>
      {roles.length === 0 ? (
        <p className="muted">Elige al menos un perfil.</p>
      ) : modules.length === 0 ? (
        <p className="muted">Estos perfiles tienen los mismos permisos.</p>
      ) : (
        <table className="profiles-compare">
          <thead>
            <tr>
              <th>Permiso</th>
              {roles.map((role) => (
                <th key={role.id} className="compare-role">
                  {role.name}
                </th>
              ))}
            </tr>
          </thead>
          {modules.map((module) => (
            <tbody key={module.key}>
              <tr className="module-row">
                <th colSpan={roles.length + 1} scope="colgroup">
                  {module.label}
                </th>
              </tr>
              {module.visible.map((action) => (
                <tr key={action.code}>
                  <td>{action.label}</td>
                  {roles.map((role) => (
                    <td key={role.id} className="compare-cell">
                      <Mark granted={role.permissions.includes(action.code)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      )}
    </div>
  );
}

export function RolesPage() {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const [view, setView] = useState<'profile' | 'compare'>('profile');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();
  const canManage = can('roles.manage');

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: async () =>
      z.array(roleResponseSchema).parse(await apiRequest('/api/roles')),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['roles'] });
    // Los permisos propios pudieron cambiar con esta edición.
    await queryClient.invalidateQueries({ queryKey: ['auth-session'] });
  };

  const save = useMutation({
    mutationFn: async (current: Draft) =>
      roleResponseSchema.parse(
        await apiRequest(
          current.id ? `/api/roles/${current.id}` : '/api/roles',
          jsonRequest(
            current.id ? 'PUT' : 'POST',
            {
              name: current.name,
              description: current.description.trim() || null,
              permissions: current.permissions,
            },
            csrfToken,
          ),
        ),
      ),
    onSuccess: async (saved) => {
      await refresh();
      setSelectedId(saved.id);
      setNotice({ kind: 'ok', text: 'Perfil guardado.' });
      setDraft(null);
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo guardar el perfil.'),
      }),
  });

  const remove = useMutation({
    mutationFn: async (role: RoleRecord) =>
      apiRequest(
        `/api/roles/${role.id}`,
        jsonRequest('DELETE', undefined, csrfToken),
      ),
    onSuccess: async () => {
      await refresh();
      setSelectedId(null);
      setNotice({ kind: 'ok', text: 'Perfil eliminado.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo borrar el perfil.'),
      }),
  });

  if (roles.isPending) {
    return <Loading />;
  }

  const list = roles.data ?? [];
  const selected =
    list.find((role) => role.id === selectedId) ?? list[0] ?? null;

  const togglePermission = (code: PermissionCode) => {
    setDraft(
      (current) =>
        current && {
          ...current,
          permissions: current.permissions.includes(code)
            ? current.permissions.filter((item) => item !== code)
            : [...current.permissions, code],
        },
    );
  };

  const confirmRemove = (role: RoleRecord) => {
    if (window.confirm(`¿Borrar el perfil "${role.name}"?`)) {
      setNotice(undefined);
      remove.mutate(role);
    }
  };

  const choose = (id: string) => {
    setNotice(undefined);
    setDraft(null);
    setSelectedId(id);
  };

  return (
    <section>
      <PageHeading
        title="Perfiles y permisos"
        description="Elige un perfil para ver qué puede hacer. Los cambios aplican de inmediato a todas las personas con ese perfil."
        action={
          canManage && (
            <button
              className="button primary"
              type="button"
              onClick={() => {
                setNotice(undefined);
                setView('profile');
                setDraft(newDraft);
              }}
            >
              Nuevo perfil
            </button>
          )
        }
      />
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {roles.isError && <Notice>{roles.error.message}</Notice>}

      <ModuleNavigation
        label="Perfiles y permisos"
        current={view}
        items={roleSections}
        onSelect={(value) => {
          setDraft(null);
          setView(value);
        }}
      >
        <div className="tabs" role="tablist">
          {roleSections.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              className={view === value ? 'tab active' : 'tab'}
              onClick={() => {
                setDraft(null);
                setView(value);
              }}
            >
              <Icon name={value === 'profile' ? 'users' : 'layers'} />
              {label}
            </button>
          ))}
        </div>
      </ModuleNavigation>

      {view === 'compare' && <CompareView list={list} />}

      {view === 'profile' && (
        <div className="profiles-layout">
          <select
            className="profile-select"
            aria-label="Perfil"
            value={selected?.id ?? ''}
            onChange={(e) => choose(e.target.value)}
          >
            {list.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name} ({people(role.userCount)})
              </option>
            ))}
          </select>
          <nav className="profile-list" aria-label="Perfiles">
            {list.map((role) => (
              <button
                key={role.id}
                type="button"
                aria-current={role.id === selected?.id ? 'true' : undefined}
                className={
                  role.id === selected?.id
                    ? 'profile-option active'
                    : 'profile-option'
                }
                onClick={() => choose(role.id)}
              >
                <strong>{role.name}</strong>
                <small>{people(role.userCount)}</small>
              </button>
            ))}
          </nav>

          {draft ? (
            <form
              className="panel"
              onSubmit={(event) => {
                event.preventDefault();
                setNotice(undefined);
                save.mutate(draft);
              }}
            >
              <div className="panel-heading">
                <h2>{draft.id ? `Editar ${draft.name}` : 'Nuevo perfil'}</h2>
              </div>
              <div className="form-grid">
                <Field label="Nombre del perfil">
                  <input
                    required
                    minLength={2}
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                </Field>
                <Field label="Descripción">
                  <input
                    value={draft.description}
                    onChange={(e) =>
                      setDraft({ ...draft, description: e.target.value })
                    }
                  />
                </Field>
              </div>
              <div className="permission-groups">
                {permissionCatalog.map((module) => (
                  <fieldset key={module.key}>
                    <legend>{module.label}</legend>
                    {module.actions.map((action) => (
                      <label className="check-field" key={action.code}>
                        <input
                          type="checkbox"
                          checked={draft.permissions.includes(action.code)}
                          onChange={() => togglePermission(action.code)}
                        />
                        {action.label}
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
              <div className="form-actions">
                <button
                  className="button primary"
                  type="submit"
                  disabled={save.isPending}
                >
                  {save.isPending ? 'Guardando…' : 'Guardar perfil'}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setDraft(null)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            selected && (
              <ProfileDetail
                role={selected}
                canManage={canManage}
                onEdit={() => {
                  setNotice(undefined);
                  setDraft({
                    id: selected.id,
                    name: selected.name,
                    description: selected.description ?? '',
                    permissions: selected.permissions,
                  });
                }}
                onRemove={() => confirmRemove(selected)}
              />
            )
          )}
        </div>
      )}
    </section>
  );
}
