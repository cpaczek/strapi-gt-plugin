import { GTRuntime } from 'generaltranslation/runtime';

export interface LedgerInput {
  locale: string;
  amount: number;
  currency: string;
  blocks: number;
  mood: string;
  cutoff: number;
  timeZone?: string;
}
export const ledgerBaseDate = '2026-10-10T12:00:00.000Z';
export const formatEnderLedger = (input: LedgerInput) => {
  const gt = new GTRuntime({ sourceLocale: 'en', targetLocale: input.locale });
  const inventory = [
    { id: 'dirt', label: 'dirt' },
    { id: 'sand', label: 'sand' },
    { id: 'dignity', label: 'questionable dignity' },
  ];
  return {
    currency: gt.formatCurrency(input.amount, input.currency),
    number: gt.formatNum(input.amount),
    date: gt.formatDateTime(new Date(ledgerBaseDate), {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: input.timeZone ?? 'UTC',
    }),
    message: gt.formatMessage(
      '{blocks, plural, =0 {No blocks. A personal crisis.} one {# block in dirt custody.} other {# blocks in dirt custody.}} {mood, select, furious {A stare crime has been reported.} calm {Everyone is being extremely normal.} other {The void declines to comment.}}',
      { variables: { blocks: input.blocks, mood: input.mood } }
    ),
    list: gt.formatList(inventory.map((item) => item.label)),
    listParts: gt.formatListToParts(inventory),
    relative: gt.formatRelativeTime(-1, 'day', { numeric: 'auto' }),
    relativeFromDate: gt.formatRelativeTimeFromDate(new Date('2026-10-10T10:00:00.000Z'), {
      baseDate: new Date(ledgerBaseDate),
      numeric: 'auto',
    }),
    cutoff: gt.formatCutoff(
      'I would like to make a short statement about the alleged block yoink.',
      { maxChars: input.cutoff }
    ),
    direction: gt.getLocaleDirection(),
    localeName: gt.getLocaleName(),
    localeProperties: gt.getLocaleProperties(),
  };
};
export const sampleExchange = (amount: number, rate: number, locale: string): string =>
  new GTRuntime({ targetLocale: locale }).formatCurrency(amount * rate, 'EUR');
