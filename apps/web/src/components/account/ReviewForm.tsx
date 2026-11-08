import { useState } from 'preact/hooks';
import { apiFetch } from '../../lib/auth-client';
import { Button, Notice, TextArea, TextInput, toFieldErrors, type FieldErrors } from '../admin/ui';

export interface ReviewValues {
  rating: number;
  title: string | null;
  comment: string | null;
}

const LABELS = ['', 'No me gustó', 'Regular', 'Bien', 'Muy bien', 'Excelente'];

/** Star rating as a real radio group: keyboard and screen readers work out of the box. */
function Stars(props: {
  value: number;
  onChange: (v: number) => void;
  error?: string | undefined;
}) {
  return (
    <fieldset>
      <legend class="text-sm font-semibold">Calificación</legend>
      <div class="mt-1 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} class="cursor-pointer">
            <input
              type="radio"
              name="rating"
              value={n}
              checked={props.value === n}
              onChange={() => props.onChange(n)}
              class="peer sr-only"
            />
            <span
              aria-hidden="true"
              class={`grid size-11 place-items-center rounded-full text-3xl peer-focus-visible:outline-3 peer-focus-visible:outline-sol-600 ${n <= props.value ? 'text-sol-600' : 'text-luna/25'}`}
            >
              ★
            </span>
            <span class="sr-only">
              {n} {n === 1 ? 'estrella' : 'estrellas'}: {LABELS[n]}
            </span>
          </label>
        ))}
        <span class="ml-2 text-sm font-semibold text-noche/80" aria-hidden="true">
          {LABELS[props.value]}
        </span>
      </div>
      {props.error && <p class="mt-1 text-sm font-medium text-sol-700">{props.error}</p>}
    </fieldset>
  );
}

export function ReviewForm(props: {
  productId: string;
  productName: string;
  initial?: ReviewValues | null;
  onSaved: () => void;
}) {
  const [rating, setRating] = useState(props.initial?.rating ?? 0);
  const [title, setTitle] = useState(props.initial?.title ?? '');
  const [comment, setComment] = useState(props.initial?.comment ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      class="space-y-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await apiFetch('/api/account/reviews', {
            method: 'POST',
            body: JSON.stringify({ productId: props.productId, rating, title, comment }),
          });
          props.onSaved();
        } catch (error) {
          const parsed = toFieldErrors(error);
          setErrors(parsed.fields);
          setMessage(parsed.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p class="font-semibold">{props.productName}</p>
      {message && <Notice tone="error">{message}</Notice>}
      <Stars value={rating} onChange={setRating} error={errors['rating']} />
      <TextInput
        id="review-title"
        label="Título (opcional)"
        value={title}
        onInput={setTitle}
        error={errors['title']}
      />
      <TextArea
        id="review-comment"
        label="Tu opinión (opcional)"
        value={comment}
        onInput={setComment}
        rows={4}
        error={errors['comment']}
        hint="Cuéntale a otros cómo te fue. La revisamos antes de publicarla."
      />
      <Button type="submit" busy={busy} disabled={rating === 0}>
        {props.initial ? 'Guardar cambios' : 'Publicar reseña'}
      </Button>
    </form>
  );
}
