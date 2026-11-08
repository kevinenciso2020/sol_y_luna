import { REVIEW_STATUS_LABELS, type ReviewStatus } from '@sol-y-luna/shared';
import { useEffect, useState } from 'preact/hooks';
import { api, formatDate, qs, type PageMeta } from './api';
import {
  Badge,
  Button,
  Loading,
  Notice,
  PageHeader,
  Pagination,
  Select,
  toFieldErrors,
} from './ui';

interface Review {
  id: string;
  rating: number;
  title: string | null;
  comment: string | null;
  status: ReviewStatus;
  verified: boolean;
  authorName: string;
  authorEmail: string;
  productName: string;
  productSlug: string;
  updatedAt: string;
}

const TONES: Record<ReviewStatus, 'warn' | 'ok' | 'danger'> = {
  PENDING: 'warn',
  APPROVED: 'ok',
  REJECTED: 'danger',
};

export default function ReviewModeration() {
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Review[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = () =>
    api
      .get<{ data: Review[]; meta: PageMeta }>(`/api/admin/reviews${qs({ status, page })}`)
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

  async function moderate(review: Review, next: 'APPROVED' | 'REJECTED') {
    try {
      await api.post(`/api/admin/reviews/${review.id}/moderate`, { status: next });
      setNotice({
        tone: 'ok',
        text: next === 'APPROVED' ? 'Reseña publicada.' : 'Reseña rechazada.',
      });
      void load();
    } catch (error) {
      setNotice({ tone: 'error', text: toFieldErrors(error).message });
    }
  }

  return (
    <div class="space-y-6">
      <PageHeader
        title="Reseñas"
        description="Solo pueden reseñar quienes recibieron el producto. Nada se publica sin tu aprobación."
      />
      <div class="max-w-xs">
        <Select
          id="reviews-status"
          label="Mostrar"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: 'PENDING', label: 'Por moderar' },
            { value: 'APPROVED', label: 'Publicadas' },
            { value: 'REJECTED', label: 'Rechazadas' },
            { value: 'ALL', label: 'Todas' },
          ]}
        />
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div class="rounded-3xl border-2 border-dashed border-luna/20 p-8 text-center">
          {status === 'PENDING' ? 'No hay reseñas por moderar.' : 'No hay reseñas.'}
        </div>
      ) : (
        <ul class="grid gap-4 lg:grid-cols-2">
          {rows.map((r) => (
            <li key={r.id} class="flex flex-col rounded-3xl bg-white p-5 ring-1 ring-luna/10">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <a
                  href={`/productos/${r.productSlug}`}
                  class="font-semibold text-luna underline-offset-4 hover:underline"
                >
                  {r.productName}
                </a>
                <Badge tone={TONES[r.status]}>{REVIEW_STATUS_LABELS[r.status]}</Badge>
              </div>
              <p class="mt-2 text-lg tracking-wider text-sol-600" aria-hidden="true">
                {'★'.repeat(r.rating)}
                <span class="text-luna/25">{'★'.repeat(5 - r.rating)}</span>
              </p>
              <p class="sr-only">{r.rating} de 5 estrellas</p>
              {r.title && <p class="font-display text-lg font-bold">{r.title}</p>}
              {r.comment ? (
                <p class="mt-1 break-words whitespace-pre-line">{r.comment}</p>
              ) : (
                <p class="mt-1 text-sm text-noche/70">Sin comentario.</p>
              )}
              <p class="mt-3 text-xs break-words text-noche/70">
                {r.authorName} ({r.authorEmail}) · {formatDate(r.updatedAt)}
                {r.verified && ' · compra verificada'}
              </p>
              <div class="mt-auto flex flex-wrap gap-2 pt-4">
                {r.status !== 'APPROVED' && (
                  <Button onClick={() => moderate(r, 'APPROVED')}>Publicar</Button>
                )}
                {r.status !== 'REJECTED' && (
                  <Button variant="secondary" onClick={() => moderate(r, 'REJECTED')}>
                    Rechazar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {meta && rows && rows.length > 0 && (
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
