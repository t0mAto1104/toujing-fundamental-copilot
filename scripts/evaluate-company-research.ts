// BYOK requires authenticated request context plus D1 permissions/credentials.
// Never restore the legacy implicit site-key bypass for standalone evaluations.
throw new Error(
  '本机直连模型验收已停用：请登录网站后主动生成验收报告，以执行 BYOK、配额和计费来源校验。离线验收使用 tests/byok.test.ts 与研究回归测试，不调用模型。',
);
export {};
