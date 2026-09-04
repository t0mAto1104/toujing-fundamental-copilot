import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFinancialTrend } from '../lib/research-financials';

void test('debt subtotal uses exact raw inputs and never labels incomplete liabilities as all debt', () => {
  const row = {
    period: '2026-06-30',
    statement: 'fzb' as const,
    sourceUrl: 'https://example.com/fzb',
    values: {
      短期借款: '713456789.00元',
      一年内到期的非流动负债: '51230000.00元',
      长期借款: '791234567.00元',
    },
  };
  const [full] = buildFinancialTrend([row]);
  assert.match(full.cashAndDebt, /小计 15.56亿元/);
  assert.match(full.cashAndDebt, /不代表全部有息负债/);
  const [missing] = buildFinancialTrend([
    { ...row, values: { 短期借款: '100元' } },
  ]);
  assert.match(missing.cashAndDebt, /三项负债未齐，不计算小计/);
  assert.doesNotMatch(missing.cashAndDebt, /小计 0/);
});
