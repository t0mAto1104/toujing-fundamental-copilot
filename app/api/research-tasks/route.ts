import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  requireResearchAccess,
  resolvePermittedAIModel,
} from '@/lib/site-users';
import { defaultResearchModel } from '@/lib/ai-models';
import { searchListedSecurities } from '@/lib/market-listings';
import {
  BATCH_LIMIT,
  createResearchBatch,
  getResearchTask,
  serializeTask,
  taskDatabase,
  taskUsage,
  unsettledReservations,
  type TaskRow,
} from '@/lib/research-tasks';

const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user)
    return Response.json({ error: '请先登录。' }, { status: 401, headers });
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (id) {
      const row = await getResearchTask(user.userId, id);
      if (!row)
        return Response.json(
          { error: '任务不存在。' },
          { status: 404, headers },
        );
      return Response.json(
        {
          task: serializeTask(row),
          report: row.report_json ? JSON.parse(row.report_json) : null,
          usage: await taskUsage(user.userId, id),
          unsettledReservations: await unsettledReservations(user.userId, id),
        },
        { headers },
      );
    }
    const rows = await taskDatabase()
      .prepare(`SELECT id, user_id, batch_id, query, listing_json, model, framework_version, pipeline_version,
      status, stage, message, error, token_limit, usd_limit, committed_tokens, committed_usd,
      lease_id, lease_expires_at, quota_consumed, completed_stages_json, created_at, updated_at,
      CASE WHEN report_json IS NULL THEN NULL ELSE '{}' END AS report_json
      FROM research_tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`)
      .bind(user.userId)
      .all<TaskRow>();
    const budgetPolicy = await taskDatabase()
      .prepare(
        'SELECT report_token_limit AS tokens, report_usd_limit AS usd FROM users WHERE id = ?',
      )
      .bind(user.userId)
      .first<{ tokens: number; usd: number }>();
    return Response.json(
      { tasks: rows.results.map(serializeTask), budgetPolicy },
      { headers },
    );
  } catch {
    return Response.json(
      { error: '任务记录暂时无法读取。' },
      { status: 503, headers },
    );
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireResearchAccess();
    if (
      request.headers.get('origin') &&
      request.headers.get('origin') !== new URL(request.url).origin
    )
      return Response.json(
        { error: '不允许跨站创建任务。' },
        { status: 403, headers },
      );
    const raw = await request.text();
    if (raw.length > 6000)
      return Response.json({ error: '请求过长。' }, { status: 413, headers });
    const body = JSON.parse(raw);
    if (
      !Array.isArray(body.items) ||
      !body.items.length ||
      body.items.length > BATCH_LIMIT ||
      body.confirmed !== true
    )
      return Response.json(
        { error: `请确认成本后提交，单批最多 ${BATCH_LIMIT} 家公司。` },
        { status: 400, headers },
      );
    const model = resolvePermittedAIModel(
      access,
      body.model ?? defaultResearchModel(access.allowedAIModels),
    );
    const verified = await Promise.all(
      body.items.map(async (item: { query?: unknown; listingId?: unknown }) => {
        if (
          typeof item.query !== 'string' ||
          !item.query.trim() ||
          item.query.length > 500
        )
          throw new Error('请输入有效公司。');
        const listings = await searchListedSecurities(item.query);
        const listing = item.listingId
          ? listings.find((x) => x.id === item.listingId)
          : listings[0];
        if (!listing) throw new Error('请使用可核验的上市公司名称或代码。');
        return { query: item.query.trim(), listing };
      }),
    );
    const unique = verified.filter(
      (item, i) =>
        verified.findIndex((x) => x.listing.id === item.listing.id) === i,
    );
    const batchId = crypto.randomUUID();
    const tasks = (
      await createResearchBatch(
        access,
        unique.map((item) => ({
          ...item,
          model,
          batchId,
          tokenLimit: body.tokenLimit,
          usdLimit: body.usdLimit,
        })),
      )
    ).map(serializeTask);
    return Response.json({ batchId, tasks }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '无法创建任务。' },
      { status: (error as { status?: number }).status || 400, headers },
    );
  }
}

export async function PATCH(request: Request) {
  const user = await getChatGPTUser();
  if (!user)
    return Response.json({ error: '请先登录。' }, { status: 401, headers });
  if (
    request.headers.get('origin') &&
    request.headers.get('origin') !== new URL(request.url).origin
  )
    return Response.json(
      { error: '不允许跨站修改。' },
      { status: 403, headers },
    );
  try {
    const raw = await request.text();
    if (raw.length > 1000) throw new Error('请求过长。');
    const body = JSON.parse(raw);
    const row =
      typeof body.id === 'string'
        ? await getResearchTask(user.userId, body.id)
        : null;
    if (!row)
      return Response.json({ error: '任务不存在。' }, { status: 404, headers });
    if (body.action === 'cancel') {
      await taskDatabase()
        .prepare(`UPDATE research_tasks SET status = CASE WHEN lease_expires_at > ? THEN 'cancelling' ELSE 'cancelled' END,
        lease_id = CASE WHEN lease_expires_at > ? THEN lease_id ELSE NULL END,
        lease_expires_at = CASE WHEN lease_expires_at > ? THEN lease_expires_at ELSE NULL END,
        message = '停止后续研究；已发出的请求可能已经计费', updated_at = ?
        WHERE user_id = ? AND id = ? AND status <> 'completed'`)
        .bind(
          new Date().toISOString(),
          new Date().toISOString(),
          new Date().toISOString(),
          new Date().toISOString(),
          user.userId,
          row.id,
        )
        .run();
    } else if (body.action === 'budget') {
      const access = await requireResearchAccess();
      const policy = await access.database
        .prepare(
          'SELECT report_token_limit AS tokens, report_usd_limit AS usd FROM users WHERE id = ?',
        )
        .bind(user.userId)
        .first<{ tokens: number; usd: number }>();
      if (
        !policy ||
        !Number.isInteger(body.tokenLimit) ||
        body.tokenLimit < row.committed_tokens ||
        body.tokenLimit < 1000 ||
        body.tokenLimit > policy.tokens ||
        !Number.isFinite(body.usdLimit) ||
        body.usdLimit <= 0 ||
        body.usdLimit < row.committed_usd ||
        body.usdLimit > policy.usd
      )
        throw new Error('预算不能低于已预留用量，且不能超过管理员上限。');
      const result = await access.database
        .prepare(`UPDATE research_tasks SET token_limit = ?, usd_limit = ? WHERE user_id = ? AND id = ?
        AND status NOT IN ('running', 'cancelling', 'completed', 'cancelled')
        AND committed_tokens <= ? AND committed_usd <= ?
        AND ? <= (SELECT report_token_limit FROM users WHERE id = ?) AND ? <= (SELECT report_usd_limit FROM users WHERE id = ?)`)
        .bind(
          body.tokenLimit,
          body.usdLimit,
          user.userId,
          row.id,
          body.tokenLimit,
          body.usdLimit,
          body.tokenLimit,
          user.userId,
          body.usdLimit,
          user.userId,
        )
        .run();
      if (!result.meta.changes)
        return Response.json(
          { error: '任务状态或预算已变化，请刷新后重试。' },
          { status: 409, headers },
        );
    } else throw new Error('未知操作。');
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '更新失败。' },
      { status: 400, headers },
    );
  }
}
