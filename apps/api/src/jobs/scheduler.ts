import type { Logger } from '../lib/logger.js';
import type { OrdersService } from '../services/orders.service.js';

/**
 * In-process scheduler (Railway runs one long-lived process). Each job is protected against
 * overlapping runs in this process, and against other instances by a Postgres advisory lock.
 */
export function startScheduler(deps: {
  orders: OrdersService;
  logger: Logger;
  intervalMs?: number;
}) {
  const { orders, logger } = deps;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await orders.expireReservations();
    } catch (error) {
      logger.error({ err: error }, 'falló el job de reservas vencidas');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), deps.intervalMs ?? 60_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
