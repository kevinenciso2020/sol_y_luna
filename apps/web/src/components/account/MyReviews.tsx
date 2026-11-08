import { REVIEW_STATUS_LABELS, type ReviewStatus } from '@sol-y-luna/shared';
import { useEffect, useState } from 'preact/hooks';
import { apiFetch } from '../../lib/auth-client';
import { formatDate } from '../admin/api';
import {
  Badge,
  Button,
  ConfirmDialog,
  FormDialog,
  Loading,
  Notice,
  toFieldErrors,
} from '../admin/ui';
import { ReviewForm } from './ReviewForm';

interface Review {
  id: string;
  productId: string;
  productName: string | null;
  productSlug: string | null;
  rating: number;
  title: string | null;
  comment: string | null;
  status: ReviewStatus;
  updatedAt: string;
}

const TONES: Record<ReviewStatus, 'warn' | 'ok' | 'danger'> = {
  PENDING: 'warn',
  APPROVED: 'ok',
  REJECTED: 'danger',
};

export default function MyReviews() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [editing, setEditing] = useState<Review | null>(null);
  const [toDelete, setToDelete] = useState<Review | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = () =>
    apiFetch<{ data: Review[] }>('/api/account/reviews')
      .then((res) => setReviews(res.data))
      .catch((e: unknown) => {
        setReviews([]);
        setNotice({ tone: 'error', text: toFieldErrors(e).message });
      });
  useEffect(() => {
    void load();
  }, []);

  if (reviews === null) return <Loading />;
  return (
    <div class="space-y-5">
      <p class="max-w-[60ch] text-noche/80">
        Puedes reseñar los productos de tus pedidos entregados desde{' '}
        <a href="/cuenta/pedidos" class="font-semibold text-luna underline underline-offset-4">
          Mis pedidos
        </a>
        . Revisamos cada reseña antes de publicarla.
      </p>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {reviews.length === 0 ? (
        <div class="rounded-[2rem] border-2 border-dashed border-luna/25 p-8 text-center">
          Aún no has escrito reseñas.
        </div>
      ) : (
        <ul class="space-y-4">
          {reviews.map((r) => (
            <li key={r.id} class="rounded-[1.5rem] bg-white p-5 ring-1 ring-luna/10">
              <div class="flex flex-wrap items-center justify-between gap-2">
                {r.productSlug ? (
                  <a
                    href={`/productos/${r.productSlug}`}
                    class="font-semibold text-luna underline-offset-4 hover:underline"
                  >
                    {r.productName}
                  </a>
                ) : (
                  <span class="font-semibold">{r.productName}</span>
                )}
                <Badge tone={TONES[r.status]}>{REVIEW_STATUS_LABELS[r.status]}</Badge>
              </div>
              <p class="mt-2 text-lg tracking-wider text-sol-600" aria-hidden="true">
                {'★'.repeat(r.rating)}
                <span class="text-luna/25">{'★'.repeat(5 - r.rating)}</span>
              </p>
              <p class="sr-only">{r.rating} de 5 estrellas</p>
              {r.title && <p class="mt-1 font-display text-lg font-bold">{r.title}</p>}
              {r.comment && <p class="mt-1 break-words whitespace-pre-line">{r.comment}</p>}
              <p class="mt-2 text-xs text-noche/70">Actualizada el {formatDate(r.updatedAt)}</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setEditing(r)}>
                  Editar
                </Button>
                <Button variant="ghost" onClick={() => setToDelete(r)}>
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <FormDialog open={editing !== null} title="Editar reseña" onClose={() => setEditing(null)}>
        {editing && (
          <ReviewForm
            key={editing.id}
            productId={editing.productId}
            productName={editing.productName ?? ''}
            initial={editing}
            onSaved={() => {
              setEditing(null);
              setNotice({
                tone: 'ok',
                text: 'Guardamos los cambios. La revisamos de nuevo antes de publicarla.',
              });
              void load();
            }}
          />
        )}
      </FormDialog>
      <ConfirmDialog
        open={toDelete !== null}
        title="Eliminar reseña"
        body={<p>¿Eliminar tu reseña de {toDelete?.productName}?</p>}
        confirmLabel="Eliminar"
        danger
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          try {
            await apiFetch(`/api/account/reviews/${toDelete!.id}`, { method: 'DELETE' });
            setNotice({ tone: 'ok', text: 'Reseña eliminada.' });
            void load();
          } catch (error) {
            setNotice({ tone: 'error', text: toFieldErrors(error).message });
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}
