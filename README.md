# 透镜｜基本面分析 Copilot

中文基本面研究工作台，包含市场指数、行业热力图、宏观政策与财经资讯、公司数据查询、AI 深度研究、报告保存与 PDF 导出、用户及 AI 使用管理。

仅用于信息研究，不构成投资建议。数据时效性和来源以页面标注及原始来源为准；AI 输出需要独立核验。

## 技术与目录

- React 19、TypeScript、Vinext / Vite、Tailwind CSS。
- 服务端运行于 Cloudflare Workers，使用 D1 持久化。
- `app/`：页面、服务端 API 与认证入口。
- `components/`：搜索、行情、Agent、报告及管理界面。
- `lib/`：HTTP 数据源、研究流程、模型策略、用量与访问控制。
- `db/`、`drizzle/`：数据库结构和迁移文件，不含实际用户数据。
- `public/`：Logo 和静态资源。
- `docs/`、`tests/`、`scripts/`：研究标准、验证记录和测试辅助工具。

## 本地运行

需要 Node.js 22.13 或更高版本和 npm。

```bash
npm ci
cp .env.example .env.local
npm run dev
```

在本机编辑 `.env.local`，仅在需要使用 AI 功能时填写 `OPENAI_API_KEY`。管理员邮箱可通过 `SITE_ADMIN_EMAILS` 设置，多个邮箱用逗号分隔；生产环境应使用托管平台的运行时配置与密钥管理。

```bash
npm run build
npm run lint
```

仓库保留原有测试文件，但尚未配置统一的 npm test 命令。部分测试依赖 Workers 环境或专用执行器，不应直接假定全部可以由 Node 原生测试运行器执行。

## 部署与迁移限制

当前项目接入 Sites 托管，`.openai/hosting.json` 记录现有站点标识和逻辑数据库绑定，不是访问凭据。GitHub 保存源码并不自动重新部署网站。

登录依赖托管网关注入的可信身份头以及登录/登出路由。迁移到其他平台时，必须适配认证和 D1 绑定，并确保外部请求不能伪造身份头；不能只复制环境变量就当成已完成安全部署。新建独立站点时也应重新注册自己的站点与数据库资源，而不是覆盖原有生产站点。

开发 Skill 是可选的本机开发辅助，不属于网站运行依赖；安装来源和版本见 `AGENTS.md`。

## GitHub 备份范围

此私有仓库保存可浏览的当前源码、资源、数据库迁移与文档。由于本机 Git 尚未配置 GitHub 登录，本次通过已授权 GitHub 连接上传；原有完整 Git 历史另外保存在仓库的 `backups/source-history-2026-09-04.bundle`，不是 GitHub 主分支上的逐条历史。

下载该文件后，可以在一个新的空目录位置恢复原始仓库：

```bash
git bundle verify source-history-2026-09-04.bundle
git clone source-history-2026-09-04.bundle toujing-restored
```

备份不包含真实 API Key、`.env.local`、登录凭据、用户数据库、私人报告、依赖安装目录、构建产物，以及 Codex 对话、日志和会话数据库。运行中的用户数据需要独立进行受保护的数据库备份。
