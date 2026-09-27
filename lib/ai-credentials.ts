import { env } from 'cloudflare:workers';
import type { ChatGPTUser } from '@/app/chatgpt-auth';
import { getReportDatabase } from '@/lib/report-database';
import { isSiteAdminUser } from '@/lib/site-users';
import { OpenAIResearchError } from '@/lib/ai-errors';
import { within } from '@/lib/request-deadline';

export type BillingSource = 'personal' | 'site';
type SealedKey = { version: 1; iv: string; ciphertext: string };
type CredentialRow = {
  encrypted_key: string;
  key_last_four: string;
  updated_at: string;
};

function setting(name: string) {
  return (
    (env as unknown as Record<string, string | undefined>)[name] ||
    process.env[name] ||
    ''
  );
}
function unavailable(): never {
  throw new OpenAIResearchError(
    'credential_unavailable',
    503,
    '个人 API 密钥存储暂不可用，请联系站点管理员；不会改用站点额度。',
    false,
  );
}
function database() {
  const db = getReportDatabase();
  if (!db) unavailable();
  return db;
}
async function masterKey() {
  const secret = setting('BYOK_ENCRYPTION_KEY');
  if (!/^[a-f0-9]{64}$/i.test(secret)) unavailable();
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(secret.match(/../g)!, (x) => parseInt(x, 16)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}
export function byokStorageConfigured() {
  return (
    /^[a-f0-9]{64}$/i.test(setting('BYOK_ENCRYPTION_KEY')) &&
    Boolean(getReportDatabase())
  );
}
export function validPersonalAPIKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^sk-[A-Za-z0-9_-]{20,509}$/.test(value) &&
    !value.startsWith('sk-admin-')
  );
}
function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}
function bytes(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
function aad(userId: string) {
  return new TextEncoder().encode(`toujing:openai:byok:v1:${userId}`);
}

export async function sealPersonalKey(
  userId: string,
  apiKey: string,
): Promise<SealedKey> {
  if (!userId || !validPersonalAPIKey(apiKey))
    throw new Error('无效的个人 API 密钥格式。');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(userId), tagLength: 128 },
    await masterKey(),
    new TextEncoder().encode(apiKey),
  );
  return {
    version: 1,
    iv: base64(iv),
    ciphertext: base64(new Uint8Array(ciphertext)),
  };
}
export async function openPersonalKey(
  userId: string,
  sealed: string,
): Promise<string> {
  try {
    const row = JSON.parse(sealed) as SealedKey;
    if (
      row.version !== 1 ||
      typeof row.iv !== 'string' ||
      typeof row.ciphertext !== 'string' ||
      row.ciphertext.length > 1024
    )
      unavailable();
    const iv = bytes(row.iv);
    if (iv.length !== 12) unavailable();
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad(userId), tagLength: 128 },
      await masterKey(),
      bytes(row.ciphertext),
    );
    const apiKey = new TextDecoder().decode(plaintext);
    if (!validPersonalAPIKey(apiKey)) unavailable();
    return apiKey;
  } catch {
    unavailable();
  }
}
async function readCredential(userId: string) {
  try {
    return await within(
      database()
        .prepare(
          'SELECT encrypted_key, key_last_four, updated_at FROM user_ai_credentials WHERE user_id = ?',
        )
        .bind(userId)
        .first<CredentialRow>(),
      4000,
    );
  } catch {
    unavailable();
  }
}
export async function getAIConnectionStatus(user: ChatGPTUser) {
  if (isSiteAdminUser(user))
    return {
      billingSource: 'site' as const,
      configured: Boolean(setting('OPENAI_API_KEY')),
      storageReady: true,
      lastFour: null,
      updatedAt: null,
    };
  // Metadata only: plaintext never leaves the resolver or appears in this DTO.
  const row = await readCredential(user.userId);
  return {
    billingSource: 'personal' as const,
    configured: Boolean(row),
    storageReady: byokStorageConfigured(),
    lastFour:
      row && /^[A-Za-z0-9_-]{4}$/.test(row.key_last_four)
        ? row.key_last_four
        : null,
    updatedAt: row?.updated_at || null,
  };
}
export async function savePersonalAIKey(user: ChatGPTUser, apiKey: string) {
  const encrypted = JSON.stringify(await sealPersonalKey(user.userId, apiKey));
  try {
    await within(
      database()
        .prepare(`INSERT INTO user_ai_credentials (user_id, encrypted_key, key_last_four, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET encrypted_key = excluded.encrypted_key, key_last_four = excluded.key_last_four, updated_at = excluded.updated_at`)
        .bind(
          user.userId,
          encrypted,
          apiKey.slice(-4),
          new Date().toISOString(),
        )
        .run(),
      4000,
    );
  } catch {
    unavailable();
  }
}
export async function deletePersonalAIKey(userId: string) {
  try {
    await within(
      database()
        .prepare('DELETE FROM user_ai_credentials WHERE user_id = ?')
        .bind(userId)
        .run(),
      4000,
    );
  } catch {
    unavailable();
  }
}
export async function resolveUserAICredential(
  user: ChatGPTUser,
): Promise<{ apiKey: string; billingSource: BillingSource }> {
  if (isSiteAdminUser(user)) {
    const apiKey = setting('OPENAI_API_KEY');
    if (!apiKey)
      throw new OpenAIResearchError(
        'missing_key',
        503,
        '管理员站点 API 密钥尚未配置。',
        false,
      );
    return { apiKey, billingSource: 'site' };
  }
  const row = await readCredential(user.userId);
  if (!row)
    throw new OpenAIResearchError(
      'byok_required',
      403,
      '请在账户设置的「AI 连接」中配置个人 OpenAI API Key；不会使用站点额度。',
      false,
    );
  return {
    apiKey: await openPersonalKey(user.userId, row.encrypted_key),
    billingSource: 'personal',
  };
}
