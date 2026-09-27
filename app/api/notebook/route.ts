import { getChatGPTUser } from '@/app/chatgpt-auth';
import { readAIRequestJSON } from '@/lib/ai-request-security';
import { NOTE_MAX_BYTES, validateNotebookDocument } from '@/lib/notebook';
import {
  discardNotebook,
  NotebookConflictError,
  readNotebook,
  saveNotebook,
} from '@/lib/notebook-store';
import { getReportDatabase } from '@/lib/report-database';
import { within } from '@/lib/request-deadline';
import { ResearchAccessError } from '@/lib/site-users';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: noStore });

async function handle(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: '登录后可保存笔记。' }, 401);
  const expectedOwner = request.headers.get('x-notebook-owner');
  if (
    (request.method !== 'GET' || expectedOwner !== null) &&
    expectedOwner !== user.userId
  )
    return reply({ error: '登录账号已变更，请刷新页面后重新打开笔记。' }, 403);
  const database = getReportDatabase();
  if (!database) return reply({ error: '笔记同步暂不可用，请稍后重试。' }, 503);
  try {
    if (request.method === 'GET')
      return reply(await within(readNotebook(database, user.userId), 4000));
    const body = await readAIRequestJSON(request, NOTE_MAX_BYTES);
    const allowed =
      request.method === 'PUT' ? ['document', 'revision'] : ['revision'];
    if (
      Object.keys(body).some((key) => !allowed.includes(key)) ||
      !Number.isSafeInteger(body.revision) ||
      body.revision < 0 ||
      body.revision >= Number.MAX_SAFE_INTEGER
    )
      return reply({ error: '笔记请求格式无效，请重新打开笔记。' }, 400);
    if (request.method === 'DELETE')
      return reply(
        await within(
          discardNotebook(database, user.userId, body.revision),
          4000,
        ),
      );
    let document;
    try {
      document = validateNotebookDocument(body.document);
    } catch (error) {
      return reply(
        { error: error instanceof Error ? error.message : '笔记格式无效。' },
        400,
      );
    }
    return reply(
      await within(
        saveNotebook(database, user.userId, document, body.revision),
        4000,
      ),
    );
  } catch (error) {
    if (error instanceof NotebookConflictError)
      return reply({ error: error.message, current: error.current }, 409);
    if (error instanceof ResearchAccessError)
      return reply({ error: error.message }, error.status);
    console.error(
      'Notebook persistence unavailable',
      error instanceof Error ? error.name : 'unknown',
    );
    return reply(
      { error: '笔记同步暂不可用，未确认保存成功，请保留当前内容后重试。' },
      503,
    );
  }
}

export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
