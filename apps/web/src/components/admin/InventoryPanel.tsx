import { STOCK_ADJUSTMENT_REASONS, STOCK_REASON_LABELS } from '@sol-y-luna/shared';
import { useEffect, useState } from 'preact/hooks';
import { api, qs, type PageMeta } from './api';
import { panelPaths, type PanelScope } from './OrdersPanel';
import {
  Badge,
  Button,
  DataList,
  FormDialog,
  Loading,
  Notice,
  PageHeader,
  Pagination,
  Select,
  TextInput,
  Toggle,
  toFieldErrors,
  type Column,
  type FieldErrors,
} from './ui';

interface VariantRow {
  id: string;
  productName: string;
  name: string;
  sku: string;
  stock: number;
  reservedStock: number;
  available: number;
  isActive: boolean;
  low: boolean;
}

function AdjustForm(props: {
  endpoint: string;
  variant: VariantRow;
  onSaved: (row: VariantRow) => void;
}) {
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<string>('RESTOCK');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const qty = Number(quantity.replace(/\D/g, '')) || 0;
  const delta = direction === 'in' ? qty : -qty;
  return (
    <form
      class="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const res = await api.post<{ data: VariantRow }>(
            `${props.endpoint}/${props.variant.id}/adjust`,
            { delta, reason, note },
          );
          props.onSaved(res.data);
        } catch (error) {
          const parsed = toFieldErrors(error);
          setErrors(parsed.fields);
          setMessage(parsed.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p class="text-sm">
        <strong>{props.variant.productName}</strong> · {props.variant.name}
        <br />
        En bodega: {props.variant.stock} · Apartadas en pedidos: {props.variant.reservedStock}
      </p>
      {message && <Notice tone="error">{message}</Notice>}
      <fieldset class="grid grid-cols-2 gap-2">
        <legend class="mb-1.5 text-sm font-semibold">Movimiento</legend>
        {(
          [
            ['in', 'Entran unidades'],
            ['out', 'Salen unidades'],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            class="flex min-h-11 cursor-pointer items-center justify-center rounded-full border-2 border-luna/20 px-3 text-sm font-semibold has-[:checked]:border-luna has-[:checked]:bg-luna has-[:checked]:text-crema"
          >
            <input
              type="radio"
              name="direction"
              value={value}
              checked={direction === value}
              onChange={() => {
                setDirection(value);
                setReason(value === 'in' ? 'RESTOCK' : 'ADJUSTMENT');
              }}
              class="sr-only"
            />
            {label}
          </label>
        ))}
      </fieldset>
      <TextInput
        id="adjust-qty"
        label="Cantidad"
        value={quantity}
        onInput={setQuantity}
        inputMode="numeric"
        error={errors['delta']}
        hint={
          qty > 0
            ? `Quedarán ${props.variant.stock + delta} en bodega (${props.variant.available + delta} disponibles)`
            : undefined
        }
      />
      <Select
        id="adjust-reason"
        label="Motivo"
        value={reason}
        onChange={setReason}
        options={STOCK_ADJUSTMENT_REASONS.map((r) => ({
          value: r,
          label: STOCK_REASON_LABELS[r] ?? r,
        }))}
        error={errors['reason']}
      />
      <TextInput
        id="adjust-note"
        label="Nota (opcional)"
        value={note}
        onInput={setNote}
        placeholder="Ej.: llegó el pedido del proveedor"
        error={errors['note']}
      />
      <Button type="submit" busy={busy} disabled={qty <= 0}>
        Guardar ajuste
      </Button>
    </form>
  );
}

export function InventoryPanel({ scope }: { scope: PanelScope }) {
  const base = `${panelPaths(scope).api}/inventory`;
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ q: '', low: false, page: 1 });
  const [rows, setRows] = useState<VariantRow[] | null>(null);
  const [meta, setMeta] = useState<(PageMeta & { lowStockThreshold: number }) | null>(null);
  const [editing, setEditing] = useState<VariantRow | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setRows(null);
    api
      .get<{ data: VariantRow[]; meta: PageMeta & { lowStockThreshold: number } }>(
        `${base}${qs({ q: filters.q, low: filters.low ? '1' : undefined, page: filters.page })}`,
      )
      .then((res) => {
        setRows(res.data);
        setMeta(res.meta);
      })
      .catch((e: unknown) => {
        setRows([]);
        setNotice({ tone: 'error', text: toFieldErrors(e).message });
      });
  }, [filters, base]);

  const columns: Column<VariantRow>[] = [
    {
      key: 'product',
      label: 'Producto',
      render: (v) => (
        <span>
          <span class="font-semibold">{v.productName}</span>
          <span class="block text-xs text-noche/70">
            {v.name} · {v.sku}
          </span>
        </span>
      ),
    },
    { key: 'stock', label: 'En bodega', class: 'text-right', render: (v) => v.stock },
    { key: 'reserved', label: 'Apartadas', class: 'text-right', render: (v) => v.reservedStock },
    {
      key: 'available',
      label: 'Disponibles',
      class: 'text-right',
      render: (v) => (
        <span class="inline-flex items-center gap-2">
          <span class="font-display text-lg font-bold">{v.available}</span>
          {v.low && <Badge tone="danger">Bajo</Badge>}
          {!v.isActive && <Badge>Inactiva</Badge>}
        </span>
      ),
    },
  ];

  return (
    <div class="space-y-6">
      <PageHeader
        title={scope === 'operator' ? 'Stock' : 'Inventario'}
        description="Registra lo que llega a bodega y corrige conteos. Cada ajuste queda con su motivo en el historial."
      />
      <form
        role="search"
        class="grid gap-3 rounded-3xl bg-white p-4 ring-1 ring-luna/10 sm:grid-cols-[1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters((f) => ({ ...f, q: q.trim(), page: 1 }));
        }}
      >
        <TextInput
          id="inventory-q"
          label="Buscar"
          value={q}
          onInput={setQ}
          placeholder="Producto, presentación o SKU"
        />
        <Toggle
          id="inventory-low"
          label={`Solo stock bajo${meta ? ` (${meta.lowStockThreshold} o menos)` : ''}`}
          checked={filters.low}
          onChange={(low) => setFilters((f) => ({ ...f, low, page: 1 }))}
        />
        <button type="submit" class="sr-only">
          Buscar
        </button>
      </form>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {rows === null ? (
        <Loading />
      ) : (
        <>
          <DataList
            rows={rows}
            columns={columns}
            caption="Inventario"
            empty={<p class="text-noche/80">No hay presentaciones con estos filtros.</p>}
            actions={(v) => (
              <Button variant="secondary" onClick={() => setEditing(v)}>
                Ajustar
                <span class="sr-only">
                  {' '}
                  {v.productName} {v.name}
                </span>
              </Button>
            )}
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
      <FormDialog open={editing !== null} title="Ajustar stock" onClose={() => setEditing(null)}>
        {editing && (
          <AdjustForm
            key={editing.id}
            endpoint={base}
            variant={editing}
            onSaved={(row) => {
              setRows((list) =>
                list ? list.map((r) => (r.id === row.id ? { ...r, ...row, low: r.low } : r)) : list,
              );
              setNotice({ tone: 'ok', text: `Stock de ${row.productName} actualizado.` });
              setEditing(null);
            }}
          />
        )}
      </FormDialog>
    </div>
  );
}

export default InventoryPanel;
