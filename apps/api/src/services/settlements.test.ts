import { describe, expect, it } from 'vitest';
import { refundCommissionReversal, settlementCsv, settlementTotals } from './settlements.js';

describe('refundCommissionReversal', () => {
  const order = { total: 100_000, commissionAmount: 10_000 };

  it('un reembolso total reversa toda la comisión', () => {
    expect(
      refundCommissionReversal(order, {
        refundedBefore: 0,
        commissionRefunded: 0,
        amount: 100_000,
      }),
    ).toBe(10_000);
  });

  it('un reembolso parcial la reversa en proporción', () => {
    expect(
      refundCommissionReversal(order, { refundedBefore: 0, commissionRefunded: 0, amount: 25_000 }),
    ).toBe(2_500);
  });

  it('varios parciales terminan exactamente en cero, sin pesos perdidos por redondeo', () => {
    const odd = { total: 99_999, commissionAmount: 9_999 };
    let refunded = 0;
    let reversed = 0;
    for (const amount of [33_333, 33_333, 33_333]) {
      reversed += refundCommissionReversal(odd, {
        refundedBefore: refunded,
        commissionRefunded: reversed,
        amount,
      });
      refunded += amount;
    }
    expect(reversed).toBe(9_999);
  });
});

describe('settlementTotals', () => {
  it('cuadra al peso: neto = ventas − reembolsos − comisión − pasarela', () => {
    const totals = settlementTotals(
      [
        { total: 129_800, commissionAmount: 12_980, gatewayFeeAmount: 3_500 },
        { total: 59_900, commissionAmount: 5_990, gatewayFeeAmount: null },
      ],
      [{ amount: 59_900, commissionReversed: 5_990 }],
    );
    expect(totals).toEqual({
      orderCount: 2,
      grossSales: 189_700,
      refundTotal: 59_900,
      commissionTotal: 12_980,
      gatewayFeeTotal: 3_500,
      netTotal: 189_700 - 59_900 - 12_980 - 3_500,
    });
  });
});

describe('settlementCsv', () => {
  it('genera un CSV con BOM, separador ; y fila de totales', () => {
    const csv = settlementCsv({
      period: { start: new Date('2026-11-01T05:00:00Z'), end: new Date('2026-11-16T05:00:00Z') },
      orders: [
        {
          number: 'SYL-000123',
          paidAt: new Date('2026-11-03T15:00:00Z'),
          customerName: 'Ana Gómez',
          total: 129_800,
          commissionAmount: 12_980,
          gatewayFeeAmount: 3_500,
        },
      ],
      refunds: [],
      totals: {
        orderCount: 1,
        grossSales: 129_800,
        refundTotal: 0,
        commissionTotal: 12_980,
        gatewayFeeTotal: 3_500,
        netTotal: 113_320,
      },
    });
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('Tipo;Pedido;Fecha;Cliente;Venta;Reembolso;Comisión;Pasarela;Neto');
    expect(lines[1]).toBe('Pedido;SYL-000123;2026-11-03;Ana Gómez;129800;0;12980;3500;113320');
    expect(lines.at(-1)).toBe('Total;;;;129800;0;12980;3500;113320');
  });

  it('neutraliza fórmulas en los textos (inyección CSV)', () => {
    const csv = settlementCsv({
      period: { start: new Date(), end: new Date() },
      orders: [
        {
          number: 'SYL-000124',
          paidAt: new Date('2026-11-03T15:00:00Z'),
          customerName: '=HYPERLINK("http://x";"y")',
          total: 1000,
          commissionAmount: 100,
          gatewayFeeAmount: null,
        },
      ],
      refunds: [],
      totals: settlementTotals(
        [{ total: 1000, commissionAmount: 100, gatewayFeeAmount: null }],
        [],
      ),
    });
    expect(csv).toContain(`"'=HYPERLINK(""http://x"";""y"")"`);
  });
});
