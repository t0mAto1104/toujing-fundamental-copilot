import type { Metadata } from 'next';

import CompanyResearch from './research-client';
import CompanyData from './data-client';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const dataPage = slug === 'data';
  const name = slug === 'xiaomi' ? '小米集团' : decodeURIComponent(slug);
  const title = dataPage
    ? '上市公司实时基本面数据｜透镜'
    : `${name}基本面分析｜透镜`;
  const description = dataPage
    ? '查看由a-stock-data数据源核验的实时行情、财务、公告、研报和资金信息；默认不调用AI。'
    : `查看${name}的财报、政策、行业、资金与宏观因素分析及来源。`;
  return {
    title,
    description,
    openGraph: { title, description, images: [] },
    twitter: { card: 'summary', title, description, images: [] },
  };
}

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return slug === 'data' ? <CompanyData /> : <CompanyResearch />;
}
