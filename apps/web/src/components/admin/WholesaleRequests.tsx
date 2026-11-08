import { WHOLESALE_STATUS_LABELS, type WholesaleStatus } from '@sol-y-luna/shared';
import { useEffect, useState } from 'preact/hooks';
import { api, formatDate, qs, type PageMeta } from './api';
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
  toFieldErrors,
  type Column,
} from './ui';

interface Request {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: WholesaleStatus;
  businessName: string | null;
  note: string | null;
  requestedAt: string | null;
}

const TONES: Record<WholesaleStatus, 'warn' | 'ok' | 'danger' | 'neutral'> = {
  NONE: 'neutral',
  PENDING: 'warn',
  APPROVED: 'ok',
  REJECTED: 'danger',
};

export default function WholesaleRequests() {
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Request[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [decision, setDecision] = useState<{ row: Request; to: 'APPROVED' | 'REJECTED' } | null>(
    null,
  );
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = () =>
    api
      .get<{ data: Request[]; meta: PageMeta }>(`/api/admin/wholesale${qs({ status, page })}`)
      .then((res) => {
        setRows(res.data);
        setMeta(res.meta);
      })
      .catch((e: unknown) => {
        setRows([]);
        setNotice({ tone: 'error', text: toFieldErrors(e).message });
      });
  useEffect(() => {
    setRows(null);
    void load();
  }, [status, page]);

  const columns: Column<Request>[] = [
    {
      key: 'customer',
      label: 'Cliente',
      render: (r) => (
        <span class="break-words">
          <span class="font-semibold">{r.name}</span>
          <span class="block text-xs text-noche/70">
            {r.email}
            {r.phone && ` · ${r.phone}`}
          </span>
        </span>
      ),
    },
    {
      key: 'business',
      label: 'Negocio',
      render: (r) => (
        <span class="break-words">
          {r.businessName ?? '—'}
          {r.note && <span class="block text-xs text-noche/70">{r.note}</span>}
        </span>
      ),
    },
    {
      key: 'date',
      label: 'Solicitada',
      render: (r) => (r.requestedAt ? formatDate(r.requestedAt) : '—'),
    },
    {
      key: 'status',
      label: 'Estado',
      render: (r) => <Badge tone={TONES[r.status]}>{WHOLESALE_STATUS_LABELS[r.status]}</Badge>,
    },
  ];

  return (
    <div class="space-y-6">
      <PageHeader
        title="Mayoristas"
        description="Al aprobar, el cliente ve los precios mayoristas y los paga solo cuando compra la cantidad mínima de cada presentación. Le avisamos por correo en ambos casos."
      />
      <div class="max-w-xs">
        <Select
          id="wholesale-status"
          label="Mostrar"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: 'PENDING', label: 'Por revisar' },
            { value: 'APPROVED', label: 'Aprobadas' },
            { value: 'REJECTED', label: 'No aprobadas' },
            { value: 'ALL', label: 'Todas' },
          ]}
        />
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {rows === null ? (
        <Loading />
      ) : (
        <DataList
          rows={rows}
          columns={columns}
          caption="Solicitudes de cuenta mayorista"
          empty={<p class="text-noche/80">No hay solicitudes con este filtro.</p>}
          actions={(r) => (
            <>
              {r.status !== 'APPROVED' && (
                <Button onClick={() => setDecision({ row: r, to: 'APPROVED' })}>Aprobar</Button>
              )}
              {r.status !== 'REJECTED' && (
                <Button variant="secondary" onClick={() => setDecision({ row: r, to: 'REJECTED' })}>
                  {r.status === 'APPROVED' ? 'Revocar' : 'Rechazar'}
                </Button>
              )}
            </>
          )}
        />
      )}
      {meta && rows && rows.length > 0 && (
        <Pagination
          page={meta.page}
          totalPages={meta.totalPages}
          total={meta.total}
          onPage={setPage}
        />
      )}
      <ConfirmDialog
        open={decision !== null}
        title={decision?.to === 'APPROVED' ? 'Aprobar cuenta mayorista' : 'No aprobar'}
        body={
          <p>
            {decision?.row.name} ({decision?.row.businessName ?? 'sin negocio'}) recibirá un correo
            con la respuesta.
          </p>
        }
        confirmLabel={decision?.to === 'APPROVED' ? 'Aprobar' : 'Confirmar'}
        danger={decision?.to === 'REJECTED'}
        onClose={() => setDecision(null)}
        onConfirm={async () => {
          if (!decision) return;
          try {
            await api.post(`/api/admin/wholesale/${decision.row.id}`, { decision: decision.to });
            setNotice({
              tone: 'ok',
              text:
                decision.to === 'APPROVED'
                  ? `${decision.row.name} ya es mayorista.`
                  : 'Respuesta enviada.',
            });
            void load();
          } catch (error) {
            setNotice({ tone: 'error', text: toFieldErrors(error).message });
          }
          setDecision(null);
        }}
      />
    </div>
  );
}
