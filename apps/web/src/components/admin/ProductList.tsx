import { formatCOP } from '@sol-y-luna/shared';
import { useEffect, useState } from 'preact/hooks';
import { imageUrl } from '../../lib/images';
import { api, qs, STATUS_LABELS, type PageMeta } from './api';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataList,
  Loading,
  Notice,
  PageHeader,
  Pagination,
  Select,
  TextInput,
  toFieldErrors,
} from './ui';

interface Row {
  id: string;
  name: string;
  slug: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  featured: boolean;
  isAdult: boolean;
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  minRetailPrice: number | null;
  variantCount: number;
  totalStock: number;
  image: { publicId: string; alt: string } | null;
}
interface Option {
  id: string;
  name: string;
}

const statusTone = { ACTIVE: 'ok', DRAFT: 'warn', ARCHIVED: 'neutral' } as const;

export default function ProductList() {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState(params.get('estado') ?? 'ALL');
  const [categoryId, setCategoryId] = useState(params.get('categoria') ?? '');
  const [page, setPage] = useState(Number(params.get('pagina') ?? '1') || 1);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [categories, setCategories] = useState<Option[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [toDelete, setToDelete] = useState<Row | null>(null);

  useEffect(() => {
    api.get<{ data: Option[] }>('/api/admin/categories').then(
      (r) => setCategories(r.data),
      () => undefined,
    );
  }, []);

  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        setError('');
        const res = await api.get<{ data: Row[]; meta: PageMeta }>(
          `/api/admin/products${qs({ q, status, categoryId, page, pageSize: 20 })}`,
        );
        setRows(res.data);
        setMeta(res.meta);
        // Keep filters in the URL so the view can be shared or reloaded.
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${qs({ q, estado: status === 'ALL' ? '' : status, categoria: categoryId, pagina: page > 1 ? page : '' })}`,
        );
      } catch (e) {
        setError(toFieldErrors(e).message);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [q, status, categoryId, page]);

  const reload = () => setPage((p) => p);

  async function changeStatus(row: Row, next: Row['status']) {
    try {
      await api.patch(`/api/admin/products/${row.id}/status`, { status: next });
      setRows((list) => list?.map((r) => (r.id === row.id ? { ...r, status: next } : r)) ?? null);
      setNotice(`"${row.name}" quedó ${STATUS_LABELS[next]?.toLowerCase()}.`);
    } catch (e) {
      setError(toFieldErrors(e).message);
    }
  }

  return (
    <div class="space-y-6">
      <PageHeader
        title="Productos"
        description="Crea, edita, publica o archiva productos y sus presentaciones."
        actions={
          <a href="/admin/productos/nuevo" class="pill-cta min-h-11">
            Nuevo producto <span aria-hidden="true">→</span>
          </a>
        }
      />

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
        <TextInput
          id="q"
          label="Buscar"
          value={q}
          placeholder="Nombre, slug o SKU"
          onInput={(v) => {
            setQ(v);
            setPage(1);
          }}
        />
        <Select
          id="status"
          label="Estado"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: 'ALL', label: 'Todos' },
            ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Select
          id="category"
          label="Categoría"
          value={categoryId}
          onChange={(v) => {
            setCategoryId(v);
            setPage(1);
          }}
          options={[
            { value: '', label: 'Todas' },
            { value: 'none', label: 'Sin categoría' },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      {rows === null ? (
        <Loading />
      ) : (
        <DataList
          caption="Productos"
          rows={rows}
          empty={
            <p>
              No hay productos con estos filtros.{' '}
              <a class="font-semibold text-luna underline" href="/admin/productos/nuevo">
                Crea el primero
              </a>
              .
            </p>
          }
          columns={[
            {
              key: 'product',
              label: 'Producto',
              render: (r) => (
                <div class="flex items-center gap-3">
                  <img
                    src={imageUrl(r.image?.publicId, 120)}
                    alt=""
                    width={48}
                    height={48}
                    loading="lazy"
                    class="size-12 shrink-0 rounded-xl bg-crema object-cover"
                  />
                  <div class="min-w-0">
                    <a
                      href={`/admin/productos/${r.id}`}
                      class="font-semibold text-luna hover:underline"
                    >
                      {r.name}
                    </a>
                    <div class="mt-0.5 flex flex-wrap gap-1">
                      {r.featured && <Badge tone="ok">Destacado</Badge>}
                      {r.isAdult && <Badge tone="danger">+18</Badge>}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              key: 'status',
              label: 'Estado',
              render: (r) => <Badge tone={statusTone[r.status]}>{STATUS_LABELS[r.status]}</Badge>,
            },
            {
              key: 'category',
              label: 'Categoría',
              render: (r) => r.category?.name ?? <span class="text-noche/60">Sin categoría</span>,
            },
            {
              key: 'price',
              label: 'Desde',
              render: (r) => (r.minRetailPrice !== null ? formatCOP(r.minRetailPrice) : '—'),
            },
            {
              key: 'stock',
              label: 'Stock',
              render: (r) => `${r.totalStock} u. · ${r.variantCount} pres.`,
            },
          ]}
          actions={(r) => (
            <>
              <a
                href={`/admin/productos/${r.id}`}
                class="inline-flex min-h-11 items-center rounded-full border-2 border-luna px-4 text-sm font-semibold text-luna hover:bg-luna-50"
              >
                Editar
              </a>
              {r.status === 'ARCHIVED' ? (
                <Button variant="ghost" onClick={() => changeStatus(r, 'ACTIVE')}>
                  Publicar
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => changeStatus(r, 'ARCHIVED')}>
                  Archivar
                </Button>
              )}
              <Button variant="ghost" class="text-sol-700" onClick={() => setToDelete(r)}>
                Borrar
              </Button>
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

      <ConfirmDialog
        open={toDelete !== null}
        title="Borrar producto"
        danger
        confirmLabel="Borrar producto"
        body={
          <p>
            "{toDelete?.name}" dejará de verse en la tienda y en el panel. Los pedidos que ya lo
            incluyen no cambian.
          </p>
        }
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await api.del(`/api/admin/products/${toDelete.id}`);
            setRows((list) => list?.filter((r) => r.id !== toDelete.id) ?? null);
            setNotice(`"${toDelete.name}" fue borrado.`);
            reload();
          } catch (e) {
            setError(toFieldErrors(e).message);
          } finally {
            setToDelete(null);
          }
        }}
      />
    </div>
  );
}
