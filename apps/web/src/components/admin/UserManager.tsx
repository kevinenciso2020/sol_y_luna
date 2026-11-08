import { useEffect, useState } from 'preact/hooks';
import { api, formatDate, qs, ROLE_LABELS, type PageMeta } from './api';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataList,
  FormDialog,
  Loading,
  Notice,
  PageHeader,
  Pagination,
  Select,
  TextInput,
  toFieldErrors,
  type FieldErrors,
} from './ui';

interface User {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: 'ADMIN' | 'OPERATOR' | 'CUSTOMER';
  emailVerified: boolean;
  wholesaleStatus: string;
  locked: boolean;
  orderCount: number;
  createdAt: string;
}

const roleOptions = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));
const roleTone = { ADMIN: 'danger', OPERATOR: 'ok', CUSTOMER: 'neutral' } as const;

export default function UserManager({ currentUserId }: { currentUserId: string }) {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('ALL');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<User[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [values, setValues] = useState({ name: '', email: '', phone: '', role: 'CUSTOMER' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<User | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        const res = await api.get<{ data: User[]; meta: PageMeta }>(
          `/api/admin/users${qs({ q, role, page })}`,
        );
        setRows(res.data);
        setMeta(res.meta);
      } catch (e) {
        setNotice({ tone: 'error', text: toFieldErrors(e).message });
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [q, role, page, version]);

  const open = (user: User | 'new') => {
    setEditing(user);
    setValues(
      user === 'new'
        ? { name: '', email: '', phone: '', role: 'OPERATOR' }
        : { name: user.name, email: user.email, phone: user.phone ?? '', role: user.role },
    );
    setErrors({});
    setFormError('');
  };

  async function submit(event: Event) {
    event.preventDefault();
    setSaving(true);
    try {
      if (editing === 'new') {
        await api.post('/api/admin/users', values);
        setNotice({
          tone: 'ok',
          text: `Usuario creado. Le enviamos a ${values.email} un enlace para crear su contraseña.`,
        });
      } else if (editing) {
        await api.put(`/api/admin/users/${editing.id}`, {
          name: values.name,
          phone: values.phone,
          role: values.role,
        });
        setNotice({ tone: 'ok', text: 'Cambios guardados.' });
      }
      setEditing(null);
      setVersion((v) => v + 1);
    } catch (e) {
      const parsed = toFieldErrors(e);
      setErrors(parsed.fields);
      setFormError(parsed.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="space-y-6">
      <PageHeader
        title="Usuarios"
        description="Clientes, operadores y administradores. Los cambios de rol quedan en la auditoría."
        actions={<Button onClick={() => open('new')}>Nuevo usuario</Button>}
      />
      <div class="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <TextInput
          id="q"
          label="Buscar"
          placeholder="Nombre, correo o celular"
          value={q}
          onInput={(v) => {
            setQ(v);
            setPage(1);
          }}
        />
        <Select
          id="role"
          label="Rol"
          value={role}
          onChange={(v) => {
            setRole(v);
            setPage(1);
          }}
          options={[{ value: 'ALL', label: 'Todos' }, ...roleOptions]}
        />
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {rows === null ? (
        <Loading />
      ) : (
        <DataList
          caption="Usuarios"
          rows={rows}
          empty={<p>No hay usuarios con estos filtros.</p>}
          columns={[
            {
              key: 'name',
              label: 'Usuario',
              render: (u) => (
                <div class="min-w-0">
                  <p class="font-semibold">{u.name}</p>
                  <p class="break-all text-noche/70">{u.email}</p>
                </div>
              ),
            },
            {
              key: 'role',
              label: 'Rol',
              render: (u) => <Badge tone={roleTone[u.role]}>{ROLE_LABELS[u.role]}</Badge>,
            },
            {
              key: 'status',
              label: 'Estado',
              render: (u) => (
                <span class="flex flex-wrap gap-1">
                  {u.locked && <Badge tone="danger">Bloqueado</Badge>}
                  {u.wholesaleStatus === 'APPROVED' && <Badge tone="ok">Mayorista</Badge>}
                  {u.wholesaleStatus === 'PENDING' && <Badge tone="warn">Pide mayorista</Badge>}
                  <Badge tone={u.emailVerified ? 'ok' : 'neutral'}>
                    {u.emailVerified ? 'Correo verificado' : 'Sin verificar'}
                  </Badge>
                </span>
              ),
            },
            { key: 'orders', label: 'Pedidos', render: (u) => String(u.orderCount) },
            {
              key: 'created',
              label: 'Registro',
              desktopOnly: true,
              render: (u) => formatDate(u.createdAt),
            },
          ]}
          actions={(u) => (
            <>
              <Button variant="secondary" onClick={() => open(u)}>
                Editar
              </Button>
              {u.locked && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await api.post(`/api/admin/users/${u.id}/unlock`, {});
                    setNotice({ tone: 'ok', text: `${u.name} puede volver a ingresar.` });
                    setVersion((v) => v + 1);
                  }}
                >
                  Desbloquear
                </Button>
              )}
              {u.id !== currentUserId && (
                <Button variant="ghost" class="text-sol-700" onClick={() => setToDelete(u)}>
                  Borrar
                </Button>
              )}
            </>
          )}
        />
      )}
      {meta && (
        <Pagination
          page={meta.page}
          totalPages={meta.totalPages}
          total={meta.total}
          onPage={setPage}
        />
      )}

      <FormDialog
        open={editing !== null}
        title={editing === 'new' ? 'Nuevo usuario' : 'Editar usuario'}
        onClose={() => setEditing(null)}
      >
        <form onSubmit={submit} noValidate class="space-y-4">
          {formError && <Notice tone="error">{formError}</Notice>}
          <TextInput
            id="u-name"
            label="Nombre"
            value={values.name}
            error={errors['name']}
            onInput={(v) => setValues({ ...values, name: v })}
          />
          {editing === 'new' ? (
            <TextInput
              id="u-email"
              label="Correo"
              type="email"
              inputMode="email"
              value={values.email}
              error={errors['email']}
              hint="Recibirá un enlace para crear su contraseña."
              onInput={(v) => setValues({ ...values, email: v })}
            />
          ) : (
            <p class="text-sm text-noche/70">Correo: {values.email}</p>
          )}
          <TextInput
            id="u-phone"
            label="Celular (opcional)"
            type="tel"
            inputMode="tel"
            value={values.phone}
            error={errors['phone']}
            onInput={(v) => setValues({ ...values, phone: v })}
          />
          <Select
            id="u-role"
            label="Rol"
            value={values.role}
            error={errors['role']}
            hint={
              editing !== 'new' && editing?.id === currentUserId
                ? 'No puedes cambiar tu propio rol.'
                : 'Operador: despacha pedidos y ajusta stock. Administrador: todo.'
            }
            onChange={(v) => setValues({ ...values, role: v })}
            options={roleOptions}
          />
          <div class="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" busy={saving}>
              Guardar
            </Button>
          </div>
        </form>
      </FormDialog>

      <ConfirmDialog
        open={toDelete !== null}
        danger
        title="Borrar usuario"
        confirmLabel="Borrar usuario"
        body={
          <p>
            Se borra la cuenta de {toDelete?.email}. Sus pedidos se conservan sin vínculo a la
            cuenta.
          </p>
        }
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await api.del(`/api/admin/users/${toDelete.id}`);
            setNotice({ tone: 'ok', text: 'Usuario borrado.' });
            setVersion((v) => v + 1);
          } catch (e) {
            setNotice({ tone: 'error', text: toFieldErrors(e).message });
          } finally {
            setToDelete(null);
          }
        }}
      />
    </div>
  );
}
