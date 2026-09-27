# 个人 API Key（BYOK）安全与验收

## 计费与数据边界

- 管理员由受信任的 Sites 登录身份和服务端 `SITE_ADMIN_EMAILS` 判定，仅使用现有站点 Key。
- 其他用户必须配置个人 OpenAI 项目 Key。缺失、解密失败、认证失败、欠费、模型权限不足或请求超时都不回退站点 Key。
- 研究 collect、两段 write、续跑、问答、行业比较、每日 AI 摘要统一经过最终鉴权入口；每次实际调用重新检查当前用户、暂停状态、允许模型和凭据。
- 每日次数上限已取消，旧 `daily_research_limit` 列仅保留作兼容，不再读写或执行。每日使用统计、同任务恢复只统计一次、并发锁、单报告预算与摘要失败冷却仍保留。
- 普通问答/深度研究模型偏好按认证用户存入 D1，新增迁移 `0008_user_model_preferences.sql`。`PATCH /api/session` 必须登录、同源 JSON、有效且获准的模型，只更新当前账户；不接受目标用户、Key 或自定义接口地址，不调用模型。未选择时仍默认 Luna/Sol；旧浏览器公共偏好不自动迁移，以免归属到错误账户。
- 市场数据 HTTP 查询不受此改动影响。已经保存的报告无需 Key，可继续打开；重新生成仍须有效凭据。
- 个人 API 费用由 Key 所属 OpenAI 项目承担。管理员仍可查看调用用量，但管理接口不能读取用户 Key。后台费用汇总包含个人及站点费用，不等于站点账单。
- BYOK 不等于本地执行：研究内容经本站后端发送给 OpenAI。保存与健康检查都不调用模型，不验证余额、有效性或模型访问权。

## 凭据保护

- D1 只保存 AES-256-GCM 密文、独立随机 96-bit IV、版本号、末四位和更新时间。
- 附加认证数据绑定站点用途、OpenAI 提供方及用户 ID；移动其他用户的密文、篡改内容或使用错误主密钥都会拒绝解密。
- 加密主密钥使用独立的 32 字节随机值，与站点 OpenAI Key、D1 数据分开管理。缺失时禁止个人凭据保存和使用，不允许明文降级。
- 浏览器只在输入和提交期间临时持有明文；不写 URL、localStorage、sessionStorage 或报告。提交、关闭弹窗后清空输入。服务器返回配置状态及末四位，不提供解密/显示原文接口。
- 凭据写入必须登录、同源、JSON 请求且显式确认费用；只允许操作自己。输入有格式和流式字节上限，不接受客户端用户 ID、管理 Key、提供方或自定义 Base URL。
- 实际凭据仅发送给固定 `https://api.openai.com/v1/responses`，禁止 HTTP 重定向，不携带其他站点 Cookie。
- 上游错误映射为固定用户提示，不转发原始异常正文。响应解码后再次脱敏，覆盖 Unicode 转义；请求日志不记录 Key、Authorization 或完整提示词。
- 已发出的请求可能已经收费，删除本地保存的凭据不能撤回请求，也不会在 OpenAI 撤销该 Key。需要彻底撤销时由用户在 OpenAI 控制台操作。

## 配置与上线

1. 经操作者同意，运行 `node scripts/configure-byok-local.mjs --create`，在 Git 忽略的 `.env.local` 生成 `BYOK_ENCRYPTION_KEY`，权限 0600。工具不会打印或覆盖已有密钥。
2. 经操作者同意，可运行 `node scripts/configure-byok-local.mjs --create --production` 单独生成生产主密钥备份（Git 忽略的 `.env.byok-production`，权限 0600，不会覆盖旧密钥或本地开发配置）。通过 Sites 的服务端秘密配置保存该独立 `BYOK_ENCRYPTION_KEY`；不要放进数据库、公开设置、`VITE_*` / `NEXT_PUBLIC_*`、构建配置或源码。生产与本地使用不同主密钥，备份应受限保存。
3. 随代码发布应用新增迁移 `0007_personal_ai_credentials.sql`。迁移仅新增表和可空用量列，历史记录的计费来源保持未知，禁止追溯猜测。
4. 生产应用新的环境版本与迁移后，验证管理员站点计费与普通用户 BYOK。没有发布前，当前线上行为不变。

不要直接覆盖生产加密主密钥。更换需要维护窗口和受控的解密—重新加密迁移，或先要求用户撤销/删除旧凭据后重新配置；本轮未提供在线自动轮换。D1 备份可能保留旧密文，删除操作仅保证移除活动记录。恢复备份必须配套原主密钥；主密钥丢失时无法恢复用户 Key，需重新配置。

## 验收及限制

`tests/byok.test.ts` 使用真实 SQLite 迁移、路由与 Web Crypto，外部请求全部模拟。覆盖匿名、跨用户、并发隔离、管理员路由、加解密、篡改、缺失/错误主密钥、CSRF、超长/错误请求、删除/替换、旧报告、续跑、配额、摘要冷却、原文及 Unicode 转义脱敏、日志及数据库输出检查。

`tests/byok-provisioning.test.ts` 在临时仓库验证显式授权、保留已有配置、0600 权限、不输出密钥、拒绝符号链接/已追踪文件，以及带 `export` 或引号的旧主密钥不会被覆盖。

`node tests/openai-worker-runtime.mjs` 将实际 `lib/openai.ts` 放入 Cloudflare workerd 执行，使用假密钥和完全拦截的出站服务验证成功返回及 6 种 3xx 拒绝。Node 的 Fetch 支持 `redirect: "error"`，但 Workers 不支持；生产代码必须使用 `manual` 并显式拒绝跳转，禁止改成自动跟随。该运行时回归补足 Node 模拟请求无法覆盖的兼容性检查，不产生真实模型调用。

`tests/research-stream-context.test.ts` 使用实际 Vinext 请求上下文、研究路由和 SQLite，模拟流式 Response 返回后框架清理 `next/headers`，再完成 collect 与两段 write。研究开始前仅绑定服务端已验证的身份到独立 AsyncLocalStorage，不保存权限、额度或密钥快照；每次调用仍重新读取暂停状态、允许模型和当前凭据。回归同时覆盖并发用户隔离、暂停/模型禁用/删除 Key 后拒绝、匿名拒绝，所有模型请求均被模拟拦截。

浏览器验收使用真实设置组件和完全模拟的 API，不绕过应用登录、不连接模型。先运行 `npx vite build --config tests/byok-ui.vite.config.ts`，再运行 `node tests/byok-ui-qa.mjs`；需要已有 Chrome 和 Playwright，可通过 `PLAYWRIGHT_MODULE` 指定已安装 Playwright 的模块入口。产物和截图放在系统临时目录，不进入应用构建。

2026-09-22 开发验收：193 项离线测试通过，TypeScript 与生产构建通过；桌面和 375px 手机窗口的保存/删除/确认/关闭清空/不可用状态检查通过，无横向溢出、无浏览器错误、模型请求为零。构建产物未包含本地真实 API Key 或加密主密钥。本地数据库已备份后应用新增迁移。后续发布前增加生产/本地主密钥独立且不可覆盖的回归；公开发布状态以 Sites 发布结果为准。

旧的本机直连模型验收脚本已停用，避免独立 CLI 无登录身份而默认消耗站点 Key。离线研究回归仍保留；真实模型验收从登录后的网页主动发起。

安全边界依赖 Sites 在可信分发层覆盖认证头、HTTPS 和服务端秘密保护；不能把本地开发服务器直接暴露到公网（本地会信任用于开发的认证头）。本轮自动化测试不等于第三方渗透测试，未验证 OpenAI 实际账户余额，也无法防御已经控制应用服务器与主密钥的攻击者。需维持依赖更新、最小平台管理员权限、主密钥安全备份与 OpenAI 项目预算限制。

实现沿用 Ponytail 的原生 Web Crypto 与现有 D1/鉴权，无新增依赖；设置界面按 UI UX Pro Max 的表单标签、费用确认、提交反馈和键盘焦点规则实现。参考 [OpenAI 生产安全指导](https://developers.openai.com/api/docs/guides/production-best-practices)。
