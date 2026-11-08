import { useEffect, useState } from 'preact/hooks';
import { api, formatDate, qs, ROLE_LABELS, type PageMeta } from './api';
import { DataList, Loading, Notice, PageHeader, Pagination, Select, toFieldErrors } from './ui';

interface Entry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  diff: unknown;
  ip: string | null;
  actorRole: string | null;
  createdAt: string;
  actor: { name: string; email: string } | null;
}

const ACTION_LABELS: Record<string, string> = {
  'product.create': 'Creó un producto',
  'product.update': 'Editó un producto',
  'product.status.update': 'Cambió el estado de un producto',
  'product.delete': 'Borró un producto',
  'variant.price.update': 'Cambió un precio',
  'variant.stock.update': 'Cambió el stock',
  'variant.create': 'Agregó una presentación',
  'variant.update': 'Editó una presentación',
  'variant.delete': 'Borró una presentación',
  'variant.deactivate': 'Desactivó una presentación',
  'category.create': 'Creó una categoría',
  'category.update': 'Editó una categoría',
  'category.delete': 'Borró una categoría',
  'brand.create': 'Creó una marca',
  'brand.update': 'Editó una marca',
  'brand.delete': 'Borró una marca',
  'coupon.create': 'Creó un cupón',
  'coupon.update': 'Editó un cupón',
  'coupon.delete': 'Borró un cupón',
  'user.create': 'Creó un usuario',
  'user.update': 'Editó un usuario',
  'user.role.update': 'Cambió un rol',
  'user.unlock': 'Desbloqueó un usuario',
  'user.delete': 'Borró un usuario',
  'settings.update': 'Cambió la configuración',
};

const ENTITIES = [
  { value: '', label: 'Todo' },
  { value: 'Product', label: 'Productos' },
  { value: 'ProductVariant', label: 'Precios y stock' },
  { value: 'Category', label: 'Categorías' },
  { value: 'Brand', label: 'Marcas' },
  { value: 'Coupon', label: 'Cupones' },
  { value: 'User', label: 'Usuarios' },
  { value: 'StoreSettings', label: 'Configuración' },
];

export default function AuditViewer() {
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<{ data: Entry[]; meta: PageMeta }>(
        `/api/admin/audit${qs({ entity, page, pageSize: 30 })}`,
      )
      .then((r) => {
        setRows(r.data);
        setMeta(r.meta);
      })
      .catch((e) => setError(toFieldErrors(e).message));
  }, [entity, page]);

  return (
    <div class="space-y-6">
      <PageHeader
        title="Auditoría"
        description="Quién cambió qué y cuándo: precios, stock, roles, estados y configuración."
      />
      <div class="max-w-xs">
        <Select
          id="entity"
          label="Mostrar"
          value={entity}
          onChange={(v) => {
            setEntity(v);
            setPage(1);
          }}
          options={ENTITIES}
        />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {rows === null ? (
        <Loading />
      ) : (
        <DataList
          caption="Registro de auditoría"
          rows={rows}
          empty={<p>No hay cambios registrados.</p>}
          columns={[
            { key: 'date', label: 'Fecha', render: (r) => formatDate(r.createdAt) },
            {
              key: 'actor',
              label: 'Quién',
              render: (r) => (
                <span>
                  {r.actor?.name ?? 'Sistema'}
                  {r.actorRole && <span class="text-noche/60"> · {ROLE_LABELS[r.actorRole]}</span>}
                </span>
              ),
            },
            { key: 'action', label: 'Acción', render: (r) => ACTION_LABELS[r.action] ?? r.action },
            {
              key: 'diff',
              label: 'Detalle',
              render: (r) =>
                r.diff ? (
                  <details>
                    <summary class="cursor-pointer font-semibold text-luna">Ver cambios</summary>
                    <pre class="mt-2 max-w-full overflow-x-auto rounded-xl bg-crema-100 p-3 text-xs whitespace-pre-wrap">
                      {JSON.stringify(r.diff, null, 2)}
                    </pre>
                  </details>
                ) : (
                  '—'
                ),
            },
            { key: 'ip', label: 'IP', desktopOnly: true, render: (r) => r.ip ?? '—' },
          ]}
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
    </div>
  );
}
