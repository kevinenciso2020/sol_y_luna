import { SETTLEMENT_STATUS_LABELS, formatCOP, type SettlementStatus } from '@sol-y-luna/shared';
import { useEffect, useState } from 'preact/hooks';
import { apiBlob } from '../../lib/auth-client';
import { api, formatDate } from './api';
import { panelPaths, type PanelScope } from './OrdersPanel';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataList,
  FormDialog,
  Loading,
  Notice,
  PageHeader,
  TextArea,
  TextInput,
  toFieldErrors,
  type Column,
} from './ui';

interface SettlementSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: SettlementStatus;
  orderCount: number;
  grossSales: number;
  refundTotal: number;
  commissionTotal: number;
  gatewayFeeTotal: number;
  netTotal: number;
  notes: string | null;
  closedAt: string | null;
  paidAt: string | null;
}

interface SettlementDetail extends SettlementSummary {
  orders: {
    number: string;
    paidAt: string | null;
    customerName: string;
    total: number;
    commissionAmount: number;
    gatewayFeeAmount: number;
    net: number;
  }[];
  refunds: {
    id: string;
    number: string;
    customerName: string;
    createdAt: string;
    amount: number;
    commissionReversed: number;
    reason: string;
  }[];
}

const day = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Bogota',
});
/** "1 – 15 de noviembre de 2026" (the end is exclusive, so show the day before). */
export const periodLabel = (s: { periodStart: string; periodEnd: string }) => {
  const start = new Date(s.periodStart);
  const end = new Date(new Date(s.periodEnd).getTime() - 1);
  return day.formatRange(start, end);
};

const TONES: Record<SettlementStatus, 'warn' | 'neutral' | 'ok'> = {
  OPEN: 'warn',
  CLOSED: 'neutral',
  PAID: 'ok',
};

function Totals({ s }: { s: SettlementSummary }) {
  const rows: [string, number, boolean?][] = [
    ['Ventas', s.grossSales],
    ['Reembolsos', -s.refundTotal],
    ['Comisión de la plataforma', -s.commissionTotal],
    ['Comisión de la pasarela', -s.gatewayFeeTotal],
  ];
  return (
    <dl class="rounded-3xl bg-white p-5 ring-1 ring-luna/10">
      {rows.map(([label, value]) => (
        <div key={label} class="flex justify-between gap-4 py-1 text-sm">
          <dt>{label}</dt>
          <dd class="tabular-nums">{value < 0 ? `−${formatCOP(-value)}` : formatCOP(value)}</dd>
        </div>
      ))}
      <div class="mt-2 flex items-baseline justify-between gap-4 border-t-2 border-luna pt-3">
        <dt class="font-semibold text-luna">Neto para la tienda</dt>
        <dd class="font-display text-3xl font-bold text-luna tabular-nums">
          {formatCOP(s.netTotal)}
        </dd>
      </div>
    </dl>
  );
}

function Detail(props: {
  scope: PanelScope;
  id: string;
  onChanged: (s: SettlementSummary) => void;
  onDeleted: () => void;
}) {
  const base = `${panelPaths(props.scope).api}/settlements/${props.id}`;
  const [s, setS] = useState<SettlementDetail | null>(null);
  const [notes, setNotes] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<'close' | 'pay' | 'delete' | null>(null);

  useEffect(() => {
    api.get<{ data: SettlementDetail }>(base).then((res) => {
      setS(res.data);
      setNotes(res.data.notes ?? '');
    });
  }, [base]);

  if (!s) return <Loading />;

  async function run(path: string, ok: string) {
    try {
      const res = await api.post<{ data: SettlementDetail }>(`${base}/${path}`, {});
      setS(res.data);
      props.onChanged(res.data);
      setNotice({ tone: 'ok', text: ok });
    } catch (error) {
      setNotice({ tone: 'error', text: toFieldErrors(error).message });
    }
    setConfirm(null);
  }

  async function download() {
    try {
      const blob = await apiBlob(`${base}/csv`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `liquidacion-${s!.periodStart.slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice({ tone: 'error', text: toFieldErrors(error).message });
    }
  }

  const admin = props.scope === 'admin';
  return (
    <div class="space-y-5">
      <div class="flex flex-wrap items-center gap-2">
        <Badge tone={TONES[s.status]}>{SETTLEMENT_STATUS_LABELS[s.status]}</Badge>
        {s.closedAt && <span class="text-sm">Cerrada el {formatDate(s.closedAt)}</span>}
        {s.paidAt && <span class="text-sm">· Pagada el {formatDate(s.paidAt)}</span>}
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <Totals s={s} />
      <div class="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={download}>
          Descargar CSV
        </Button>
        {admin && s.status === 'OPEN' && (
          <>
            <Button
              variant="secondary"
              onClick={() => run('recalculate', 'Liquidación recalculada.')}
            >
              Recalcular
            </Button>
            <Button onClick={() => setConfirm('close')}>Cerrar liquidación</Button>
            <Button variant="ghost" onClick={() => setConfirm('delete')}>
              Eliminar
            </Button>
          </>
        )}
        {admin && s.status === 'CLOSED' && (
          <Button onClick={() => setConfirm('pay')}>Marcar como pagada</Button>
        )}
      </div>

      <section>
        <h3 class="font-display text-lg text-luna">Pedidos ({s.orders.length})</h3>
        {s.orders.length === 0 ? (
          <p class="mt-2 text-sm text-noche/80">No hubo pedidos pagados en este periodo.</p>
        ) : (
          <ul class="mt-2 divide-y divide-luna/10 rounded-3xl bg-white px-4 ring-1 ring-luna/10">
            {s.orders.map((o) => (
              <li
                key={o.number}
                class="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3 text-sm"
              >
                <span>
                  <strong>{o.number}</strong> · {o.customerName}
                  <span class="block text-xs text-noche/70">
                    {o.paidAt ? formatDate(o.paidAt) : ''}
                  </span>
                </span>
                <span class="text-right tabular-nums">
                  {formatCOP(o.total)}
                  <span class="block text-xs text-noche/70">
                    Comisión {formatCOP(o.commissionAmount)} · Neto {formatCOP(o.net)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {s.refunds.length > 0 && (
        <section>
          <h3 class="font-display text-lg text-luna">Reembolsos ({s.refunds.length})</h3>
          <ul class="mt-2 divide-y divide-luna/10 rounded-3xl bg-white px-4 ring-1 ring-luna/10">
            {s.refunds.map((r) => (
              <li key={r.id} class="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3 text-sm">
                <span>
                  <strong>{r.number}</strong> · {r.reason}
                  <span class="block text-xs text-noche/70">{formatDate(r.createdAt)}</span>
                </span>
                <span class="text-right tabular-nums">
                  −{formatCOP(r.amount)}
                  <span class="block text-xs text-noche/70">
                    Comisión reversada {formatCOP(r.commissionReversed)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {admin ? (
        <form
          class="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const res = await api.put<{ data: SettlementDetail }>(`${base}/notes`, { notes });
              setS(res.data);
              setNotice({ tone: 'ok', text: 'Notas guardadas.' });
            } catch (error) {
              setNotice({ tone: 'error', text: toFieldErrors(error).message });
            }
          }}
        >
          <TextArea
            id="settlement-notes"
            label="Notas"
            value={notes}
            onInput={setNotes}
            hint="Por ejemplo, el número de la transferencia con la que se pagó."
          />
          <Button type="submit" variant="secondary">
            Guardar notas
          </Button>
        </form>
      ) : (
        s.notes && <p class="text-sm break-words">Notas: {s.notes}</p>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'close'
            ? 'Cerrar liquidación'
            : confirm === 'pay'
              ? 'Marcar como pagada'
              : 'Eliminar liquidación'
        }
        body={
          <p>
            {confirm === 'close' &&
              'Se suman los pedidos y reembolsos que falten del periodo y los totales quedan fijos.'}
            {confirm === 'pay' && `Confirma que la tienda recibió ${formatCOP(s.netTotal)}.`}
            {confirm === 'delete' &&
              'Los pedidos y reembolsos quedan libres para una nueva liquidación del periodo.'}
          </p>
        }
        confirmLabel={
          confirm === 'close' ? 'Cerrar' : confirm === 'pay' ? 'Marcar como pagada' : 'Eliminar'
        }
        danger={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm === 'close') await run('close', 'Liquidación cerrada.');
          else if (confirm === 'pay') await run('pay', 'Liquidación marcada como pagada.');
          else {
            try {
              await api.del(base);
              props.onDeleted();
            } catch (error) {
              setNotice({ tone: 'error', text: toFieldErrors(error).message });
              setConfirm(null);
            }
          }
        }}
      />
    </div>
  );
}

export function SettlementsPanel({ scope }: { scope: PanelScope }) {
  const base = `${panelPaths(scope).api}/settlements`;
  const [rows, setRows] = useState<SettlementSummary[] | null>(null);
  const [open, setOpen] = useState<SettlementSummary | null>(null);
  const [date, setDate] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<{ data: SettlementSummary[] }>(base)
      .then((res) => setRows(res.data))
      .catch((e: unknown) => {
        setRows([]);
        setNotice({ tone: 'error', text: toFieldErrors(e).message });
      });
  useEffect(() => {
    void load();
  }, [base]);

  const columns: Column<SettlementSummary>[] = [
    {
      key: 'period',
      label: 'Periodo',
      render: (s) => <span class="font-semibold">{periodLabel(s)}</span>,
    },
    {
      key: 'status',
      label: 'Estado',
      render: (s) => <Badge tone={TONES[s.status]}>{SETTLEMENT_STATUS_LABELS[s.status]}</Badge>,
    },
    { key: 'orders', label: 'Pedidos', class: 'text-right', render: (s) => s.orderCount },
    {
      key: 'gross',
      label: 'Ventas',
      class: 'text-right tabular-nums',
      render: (s) => formatCOP(s.grossSales - s.refundTotal),
    },
    {
      key: 'commission',
      label: 'Comisión',
      class: 'text-right tabular-nums',
      render: (s) => formatCOP(s.commissionTotal),
    },
    {
      key: 'net',
      label: 'Neto',
      class: 'text-right tabular-nums',
      render: (s) => <span class="font-display font-bold">{formatCOP(s.netTotal)}</span>,
    },
  ];

  return (
    <div class="space-y-6">
      <PageHeader
        title="Liquidaciones"
        description={
          scope === 'admin'
            ? 'Cada periodo suma los pedidos pagados y los reembolsos, descuenta la comisión de la plataforma y la de la pasarela, y deja el neto para la tienda.'
            : 'Lo que vendiste en cada periodo, la comisión de la plataforma y el neto que recibes.'
        }
      />
      {scope === 'admin' && (
        <form
          class="grid gap-3 rounded-3xl bg-white p-4 ring-1 ring-luna/10 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const res = await api.post<{ data: SettlementSummary }>(base, {
                ...(date ? { date: new Date(`${date}T12:00:00-05:00`).toISOString() } : {}),
              });
              setNotice({ tone: 'ok', text: `Liquidación de ${periodLabel(res.data)} generada.` });
              setDate('');
              await load();
              setOpen(res.data);
            } catch (error) {
              setNotice({ tone: 'error', text: toFieldErrors(error).message });
            } finally {
              setBusy(false);
            }
          }}
        >
          <TextInput
            id="settlement-date"
            label="Periodo (opcional)"
            type="date"
            value={date}
            onInput={setDate}
            hint="Vacío = el último periodo que ya terminó. Escribe cualquier día para liquidar el periodo que lo contiene."
          />
          <Button type="submit" busy={busy}>
            Generar liquidación
          </Button>
        </form>
      )}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {rows === null ? (
        <Loading />
      ) : (
        <DataList
          rows={rows}
          columns={columns}
          caption="Liquidaciones"
          empty={
            <p class="text-noche/80">
              {scope === 'admin'
                ? 'Aún no hay liquidaciones. Genera la del último periodo con el botón de arriba.'
                : 'Aún no hay liquidaciones.'}
            </p>
          }
          actions={(s) => (
            <Button variant="secondary" onClick={() => setOpen(s)}>
              Ver detalle<span class="sr-only"> de {periodLabel(s)}</span>
            </Button>
          )}
        />
      )}
      <FormDialog
        open={open !== null}
        title={open ? `Liquidación ${periodLabel(open)}` : ''}
        onClose={() => setOpen(null)}
      >
        {open && (
          <Detail
            key={open.id}
            scope={scope}
            id={open.id}
            onChanged={(s) =>
              setRows((list) =>
                list ? list.map((r) => (r.id === s.id ? { ...r, ...s } : r)) : list,
              )
            }
            onDeleted={() => {
              setOpen(null);
              setNotice({ tone: 'ok', text: 'Liquidación eliminada.' });
              void load();
            }}
          />
        )}
      </FormDialog>
    </div>
  );
}

export default SettlementsPanel;
