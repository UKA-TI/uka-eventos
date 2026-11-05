import {
  agingBucket,
  fiscalDataSchema,
  nextReminderStage,
  orderFinancialStatus,
  paymentDueDate,
  suggestedRefundPercent,
} from '@uka/shared';
import { describe, expect, it } from 'vitest';

const day = 86_400_000;
const now = new Date('2027-01-15T12:00:00Z');
const inDays = (days: number) => new Date(now.getTime() + days * day);

describe('financial status comes from the money', () => {
  const status = (
    state: string,
    amountDue: number,
    amountPaid: number,
    amountRefunded = 0,
  ) =>
    orderFinancialStatus({
      status: state,
      amountDue,
      amountPaid,
      amountRefunded,
    });

  it('tells apart unpaid, partial and paid', () => {
    expect(status('pending_payment', 1000, 0)).toBe('pending');
    expect(status('pending_payment', 1000, 400)).toBe('partial');
    expect(status('confirmed', 1000, 1000)).toBe('paid');
    expect(status('confirmed', 0, 0)).toBe('free');
  });

  it('tells apart partial and full refunds', () => {
    expect(status('confirmed', 1000, 1000, 300)).toBe('partially_refunded');
    expect(status('confirmed', 1000, 1000, 1000)).toBe('refunded');
  });

  it('shows what happened to the money of a cancelled order', () => {
    expect(status('cancelled', 1000, 0)).toBe('cancelled');
    expect(status('cancelled', 1000, 1000, 1000)).toBe('cancelled_refunded');
    expect(status('cancelled', 1000, 1000, 400)).toBe('cancelled_retained');
    expect(status('cancelled', 1000, 500)).toBe('cancelled_retained');
  });
});

describe('aging of what is owed', () => {
  it('sorts by days overdue, on each boundary', () => {
    expect(agingBucket(null, now)).toBe('no_date');
    expect(agingBucket(inDays(5), now)).toBe('current');
    expect(agingBucket(now, now)).toBe('current');
    expect(agingBucket(inDays(-1), now)).toBe('d1_7');
    expect(agingBucket(inDays(-7), now)).toBe('d1_7');
    expect(agingBucket(inDays(-8), now)).toBe('d8_30');
    expect(agingBucket(inDays(-30), now)).toBe('d8_30');
    expect(agingBucket(inDays(-31), now)).toBe('d31');
  });
});

describe('payment reminder schedule', () => {
  it('waits until three days before the due date', () => {
    expect(nextReminderStage(inDays(4), 0, now)).toBeNull();
    expect(nextReminderStage(inDays(3), 0, now)).toBe(1);
  });

  it('moves through each stage once', () => {
    expect(nextReminderStage(now, 1, now)).toBe(2);
    expect(nextReminderStage(now, 2, now)).toBeNull();
    expect(nextReminderStage(inDays(-3), 2, now)).toBe(3);
    expect(nextReminderStage(inDays(-7), 3, now)).toBe(4);
  });

  it('stops after the last reminder', () => {
    expect(nextReminderStage(inDays(-90), 4, now)).toBeNull();
  });

  it('sends one email, not several, after a long outage', () => {
    expect(nextReminderStage(inDays(-20), 0, now)).toBe(4);
  });
});

describe('refund suggested by the cancellation policy', () => {
  const tiers = [
    { daysBefore: 15, percent: 50 },
    { daysBefore: 30, percent: 100 },
  ];

  it('uses the first deadline still met, whatever the order typed', () => {
    expect(suggestedRefundPercent(tiers, inDays(45), now)).toBe(100);
    expect(suggestedRefundPercent(tiers, inDays(30), now)).toBe(100);
    expect(suggestedRefundPercent(tiers, inDays(29), now)).toBe(50);
    expect(suggestedRefundPercent(tiers, inDays(15), now)).toBe(50);
  });

  it('suggests nothing after the last deadline', () => {
    expect(suggestedRefundPercent(tiers, inDays(14), now)).toBe(0);
  });

  it('does not guess without a policy or a date', () => {
    expect(suggestedRefundPercent([], inDays(45), now)).toBeNull();
    expect(suggestedRefundPercent(tiers, null, now)).toBeNull();
  });
});

describe('payment due date', () => {
  const event = {
    paymentTermDays: 7,
    corporateTermDays: 15,
    paymentCutoffDays: 10,
    startsAt: inDays(60) as Date | null,
  };

  it('gives a table more time than a single seat', () => {
    expect(paymentDueDate(event, 1, now)).toEqual(inDays(7));
    expect(paymentDueDate(event, 10, now)).toEqual(inDays(15));
  });

  it('never goes past the cutoff before the event', () => {
    const soon = { ...event, startsAt: inDays(20) };
    expect(paymentDueDate(soon, 1, now)).toEqual(inDays(7));
    expect(paymentDueDate(soon, 10, now)).toEqual(inDays(10));
  });

  it('gives two days to someone buying after the cutoff', () => {
    const late = { ...event, startsAt: inDays(5) };
    expect(paymentDueDate(late, 1, now)).toEqual(inDays(2));
    expect(paymentDueDate(late, 10, now)).toEqual(inDays(2));
  });

  it('never passes the event itself', () => {
    const tomorrow = { ...event, startsAt: inDays(1) };
    expect(paymentDueDate(tomorrow, 1, now)).toEqual(inDays(1));
  });

  it('uses the plain term without an event date, or after it started', () => {
    expect(paymentDueDate({ ...event, startsAt: null }, 1, now)).toEqual(
      inDays(7),
    );
    expect(paymentDueDate({ ...event, startsAt: inDays(-1) }, 1, now)).toEqual(
      inDays(7),
    );
  });
});

describe('fiscal data', () => {
  const valid = {
    rfc: 'ukd900101ab1',
    legalName: 'Empresa SA de CV',
    regime: '601',
    postalCode: '06600',
    cfdiUse: 'G03',
    email: 'FACTURAS@empresa.test',
  };

  it('normalizes a company RFC and a person RFC', () => {
    const parsed = fiscalDataSchema.parse(valid);
    expect(parsed.rfc).toBe('UKD900101AB1');
    expect(parsed.email).toBe('facturas@empresa.test');
    expect(
      fiscalDataSchema.safeParse({ ...valid, rfc: 'PERJ900101AB1' }).success,
    ).toBe(true);
  });

  it('rejects what the SAT would reject', () => {
    for (const change of [
      { rfc: 'ABC' },
      { rfc: 'UKD90010AB1' },
      { postalCode: '123' },
      { regime: '999' },
      { cfdiUse: 'X99' },
    ]) {
      expect(fiscalDataSchema.safeParse({ ...valid, ...change }).success).toBe(
        false,
      );
    }
  });
});
