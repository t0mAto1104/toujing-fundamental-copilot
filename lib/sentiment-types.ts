export type PopularityItem = {
  symbol: string;
  name: string;
  rank: number;
  rankChange: number | null;
  heat: string;
  percent: number | null;
  price: number | null;
  quoteAsOf: string | null;
  concepts: string[];
  tag: string;
};

export type PopularityData = {
  items: PopularityItem[];
  sourceAsOf: string | null;
  period: 'hour' | 'day' | 'current';
  quoteUnavailable?: boolean;
};

export type ConceptHit = {
  code: string;
  name: string;
  hits: number | null;
  sourceAsOf: string | null;
};

export type ConceptHeatData = {
  symbol: string;
  items: ConceptHit[];
  sourceAsOf: string | null;
};

export type InvestorQuestion = {
  id: string;
  symbol: string;
  company: string;
  question: string;
  answer: string | null;
  answerer: string;
  askedAt: string;
  answeredAt: string | null;
  url: string;
};

export type InvestorQuestionsData = {
  symbol: string;
  days: 7 | 30;
  start: string;
  end: string;
  items: InvestorQuestion[];
  page: number;
  hasMore: boolean;
  coverage: string;
};
