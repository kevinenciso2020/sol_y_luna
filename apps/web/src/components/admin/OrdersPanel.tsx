import { ORDER_STATUS_LABELS, formatCOP, type OrderStatus } from '@sol-y-luna/shared';
import { useEffect, useState } from 'preact/hooks';
import { api, formatDate, qs, type PageMeta } from './api';
import {
  Badge,
  DataList,
  Loading,
  Notice,
  PageHeader,
  Pagination,
  Select,
  TextInput,
  Toggle,
  toFieldErrors,
  type Column,
} from './ui';

export type PanelScope = 'admin' | 'operator';

export const panelPaths = (scope: PanelScope) =>
  scope === 'admin'
    ? { api: '/api/admin', orders: '/admin/pedidos' }
    : { api: '/api/operator', orders: '/operador/pedidos' };

const STATUS_TONES: Record<OrderStatus, 'ok' | 'warn' | 'neutral' | 'danger'> = {
  PENDING_PAYMENT: 'neutral',
  PAYMENT_FAILED: 'danger',
  PAID: 'warn',
  PREPARING: 'warn',
  SHIPPED: 'ok',
  DELIVERED: 'ok',
  CANCELLED: 'neutral',
  REFUNDED: 'danger',
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

interface OrderRow {
  id: string;
  number: string;
  status: OrderStatus;
  createdAt: string;
  paidAt: string | null;
  customerName: string;
  municipality: string;
  department: string;
  total: number;
  itemCount: number;
  discreetPackaging: boolean;
  needsReview: boolean;
  shipment: { carrier: string; trackingNumber: string } | null;
}

const OPERATOR_FILTERS = [
  { value: 'TO_DISPATCH', label: 'Por despachar' },
  { value: 'PREPARING', label: 'Preparando' },
  { value: 'SHIPPED', label: 'Despachados' },
  { value: 'DELIVERED', label: 'Entregados' },
  { value: 'REFUNDED', label: 'Reembolsados' },
  { value: 'ALL', label: 'Todos' },
];
const ADMIN_FILTERS = [
  { value: 'ALL', label: 'Todos' },
  { value: 'TO_DISPATCH', label: 'Por despachar' },
  ...(
    [
      'PENDING_PAYMENT',
      'PAID',
      'PREPARING',
      'SHIPPED',
      'DELIVERED',
      'PAYMENT_FAILED',
      'CANCELLED',
      'REFUNDED',
    ] as const
  ).map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] })),
];

/** Keeps the filters in the URL so a filtered list can be shared or reloaded. */
function readFilters(scope: PanelScope) {
  const params = new URLSearchParams(window.location.search);
  return {
    status: params.get('estado') ?? (scope === 'operator' ? 'TO_DISPATCH' : 'ALL'),
    q: params.get('q') ?? '',
    review: params.get('revision') === '1',
    page: Math.max(1, Number(params.get('pagina')) || 1),
  };
}

export function OrdersPanel({ scope }: { scope: PanelScope }) {
  const paths = panelPaths(scope);
  const [filters, setFilters] = useState(() => readFilters(scope));
  const [search, setSearch] = useState(filters.q);
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const url = qs({
      estado: filters.status,
      q: filters.q,
      revision: filters.review ? '1' : undefined,
      pagina: filters.page > 1 ? filters.page : undefined,
    });
    window.history.replaceState(null, '', `${window.location.pathname}${url}`);
    setRows(null);
    api
      .get<{ data: OrderRow[]; meta: PageMeta }>(
        `${paths.api}/orders${qs({
          status: filters.status,
          q: filters.q,
          review: filters.review ? '1' : undefined,
          page: filters.page,
        })}`,
      )
      .then((res) => {
        setRows(res.data);
        setMeta(res.meta);
        setError('');
      })
      .catch((e: unknown) => {
        setRows([]);
        setError(toFieldErrors(e).message);
      });
  }, [filters, paths.api]);

  const columns: Column<OrderRow>[] = [
    {
      key: 'number',
      label: 'Pedido',
      render: (o) => (
        <a
          href={`${paths.orders}/${o.number}`}
          class="font-display text-base font-bold text-luna underline-offset-4 hover:underline"
        >
          {o.number}
        </a>
      ),
    },
    {
      key: 'status',
      label: 'Estado',
      render: (o) => (
        <span class="flex flex-wrap gap-1">
          <StatusBadge status={o.status} />
          {o.discreetPackaging && <Badge tone="warn">Empaque discreto</Badge>}
          {o.needsReview && <Badge tone="danger">Revisar</Badge>}
        </span>
      ),
    },
    {
      key: 'customer',
      label: 'Cliente',
      render: (o) => (
        <span>
          {o.customerName}
          <span class="block text-xs text-noche/70">
            {o.municipality}, {o.department}
          </span>
        </span>
      ),
    },
    {
      key: 'date',
      label: scope === 'operator' ? 'Pagado' : 'Fecha',
      render: (o) => formatDate(scope === 'operator' && o.paidAt ? o.paidAt : o.createdAt),
    },
    {
      key: 'items',
      label: 'Productos',
      desktopOnly: true,
      render: (o) => `${o.itemCount} ${o.itemCount === 1 ? 'línea' : 'líneas'}`,
    },
    {
      key: 'shipment',
      label: 'Guía',
      render: (o) =>
        o.shipment ? `${o.shipment.carrier} · ${o.shipment.trackingNumber}` : 'Sin guía',
    },
    {
      key: 'total',
      label: 'Total',
      class: 'text-right',
      render: (o) => <span class="font-display font-bold">{formatCOP(o.total)}</span>,
    },
  ];

  const update = (patch: Partial<typeof filters>) =>
    setFilters((f) => ({ ...f, page: 1, ...patch }));

  return (
    <div class="space-y-6">
      <PageHeader
        title={scope === 'operator' ? 'Pedidos por despachar' : 'Pedidos'}
        description={
          scope === 'operator'
            ? 'Los pagos más antiguos salen primero. Abre un pedido para prepararlo y registrar la guía.'
            : 'Todos los pedidos de la tienda, con su pago, despacho, reembolsos y comisión.'
        }
      />
      <form
        class="grid gap-3 rounded-3xl bg-white p-4 ring-1 ring-luna/10 sm:grid-cols-[1fr_14rem] lg:grid-cols-[1fr_14rem_auto] lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: search.trim() });
        }}
        role="search"
      >
        <TextInput
          id="orders-q"
          label="Buscar"
          value={search}
          onInput={setSearch}
          placeholder="Número, cliente, correo, teléfono o guía"
        />
        <Select
          id="orders-status"
          label="Estado"
          value={filters.status}
          onChange={(v) => update({ status: v })}
          options={scope === 'operator' ? OPERATOR_FILTERS : ADMIN_FILTERS}
        />
        {scope === 'admin' && (
          <Toggle
            id="orders-review"
            label="Solo los que requieren revisión"
            checked={filters.review}
            onChange={(v) => update({ review: v })}
          />
        )}
        <button type="submit" class="sr-only">
          Buscar
        </button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      {rows === null ? (
        <Loading />
      ) : (
        <>
          <DataList
            rows={rows}
            columns={columns}
            caption="Pedidos"
            empty={
              <p class="text-noche/80">
                {filters.status === 'TO_DISPATCH'
                  ? 'No hay pedidos por despachar. Los pagos nuevos aparecen aquí.'
                  : 'No hay pedidos con estos filtros.'}
              </p>
            }
          />
          {meta && (
            <Pagination
              page={meta.page}
              totalPages={meta.totalPages}
              total={meta.total}
              onPage={(page) => setFilters((f) => ({ ...f, page }))}
            />
          )}
        </>
      )}
    </div>
  );
}

export default OrdersPanel;
