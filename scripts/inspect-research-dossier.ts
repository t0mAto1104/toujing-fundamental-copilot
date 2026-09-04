import { mkdir, writeFile } from 'node:fs/promises';
import {
  collectResearchDossier,
  dossierForPrompt,
} from '../lib/research-dossier';
import { buildFinancialTrend } from '../lib/research-financials';
import type { ListingOption } from '../lib/market-listings';

// HTTP-only evaluation. Does not load credentials or call an AI model.
const listing: ListingOption = {
  id: 'SZ:300497',
  name: '富祥股份',
  code: '300497',
  exchange: '深圳证券交易所',
  exchangeCode: 'SZ',
  securityType: '深A',
  quoteId: '0.300497',
  currency: 'CNY',
};
const directory = `outputs/research-validation/http-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const dossier = await collectResearchDossier(listing);
const prompt = dossierForPrompt(dossier, 32_000);
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/dossier.json`, JSON.stringify(dossier, null, 2));
await writeFile(
  `${directory}/prompt-materials.json`,
  JSON.stringify(prompt, null, 2),
);
console.log(
  JSON.stringify(
    {
      directory,
      promptCharacters: JSON.stringify(prompt).length,
      attempts: dossier.attempts,
      documents: prompt.documents.map((d) => ({
        title: d.title,
        excerpts: d.excerpts.length,
        characters: d.excerpts.reduce((n, e) => n + e.text.length, 0),
        pages: d.excerpts.map((x) => x.page),
      })),
      financialTrend: buildFinancialTrend(dossier.financialHistory),
    },
    null,
    2,
  ),
);
