# 项目开发 Skills

以下 Skill 用于 Codex 开发本项目，不是网站运行时的 AI 研究工具。

- `awesome-design-md`：界面设计或样式优化任务按需使用。入口为 `/Users/jerry_t0mato/.codex/skills/awesome-design-md/SKILL.md`；先读入口，再读选中的设计参考，不要全量加载资料库。
- `ui-ux-pro-max`：界面布局、响应式、导航／触摸交互、可访问性、图表及 React UI 检查时使用。入口为 `/Users/jerry_t0mato/.codex/skills/ui-ux-pro-max/SKILL.md`；先读入口，按任务选择一个领域或已识别的技术栈检索，不全量加载资料，不因局部修复自动重建设计系统。
- `ponytail`：代码开发、修复和重构任务使用。入口为 `/Users/jerry_t0mato/.codex/skills/ponytail/SKILL.md`；先理解调用链，优先复用已有实现，以最小有效改动完成需求。

## 项目约束

- 本次接入没有选择新的品牌主题。保持现有中文界面、紧凑布局和日光／黑夜／跟随系统模式，除非用户要求改变。
- 精简实现不表示删减已有功能、安全校验、数据真实性保障、来源信息或必要测试。
- 不将这些开发 Skill 加入 `/api` 的模型提示词、collect/write 上下文或定时任务，不新增 API Key、后台服务、MCP 或自动更新任务。
- 仅安装或维护开发 Skill 不需要部署站点。业务代码改变时，仍按项目正常验证和发布流程执行。
- 技能分工：`awesome-design-md` 提供设计语言参考，`ui-ux-pro-max` 提供布局／交互／可访问性及技术栈检查，`ponytail` 控制实现复杂度。以用户要求及本项目已确定的视觉规范为准，检索建议不自动覆盖现有黑色磨砂、中文和紧凑布局。
- UI UX Pro Max 的上游示例使用 Claude 插件路径；本机 Codex 应直接调用完整路径 `python3 -B /Users/jerry_t0mato/.codex/skills/ui-ux-pro-max/scripts/search.py`，不依赖 `CLAUDE_PLUGIN_ROOT`。默认只输出检索结果；仅在确需保存设计规范时使用 `--persist --output-dir <项目目录>`，未经明确授权不得使用 `--force` 覆盖已有规范。

## 固定上游版本

- [a-stock-data](https://github.com/t0mAto1104/a-stock-data)：v3.10.0，`0f630dae2841a1a3a51abb0b8a4e154b2e3fb8de`；本机入口 `/Users/jerry_t0mato/.codex/skills/a-stock-data/SKILL.md`，项目完整原版副本 `vendor/skills/a-stock-data/SKILL.md`（含 README、CHANGELOG 和许可证）。`lib/a-stock-version.ts` 记录校验哈希，行情 API 返回实际适配版本。网站使用 HTTP＋D1 适配器，不运行 Python 服务，不将 Skill 全文加入 AI 提示词。v3.10 新接入：K 线隔离降级、科创板成交量按字段校准、按需成交明细、商品期货历史补证；未启用北交所离线包。详见 `docs/a-stock-v310-adaptation.md`。
- [awesome-design-md](https://github.com/t0mAto1104/awesome-design-md)：`8147538b4226ae41e2487a9179e3bcc1f68e8554`，已适配为本地设计资料 Skill。
- [ponytail](https://github.com/t0mAto1104/ponytail)：`2ed6c52c9d7e5e56942508591085fd45dea277d3`，只安装核心 Skill，做了 Codex 元数据、任务作用域及复用现有测试流程的兼容调整，没有安装插件 hooks。
- [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)：`7f69fed6a2717900085f1bc3b263721f8ba025e2`，从 `.claude/skills/ui-ux-pro-max` 安装完整入口、数据、参考资料与 Python 脚本；保持上游文件不变，Codex 路径约定见上文。不安装全局 npm CLI、Claude 插件或网站依赖，搜索运行于本机且不调用 OpenAI。

个人 Skill 路径仅适用于当前机器。a-stock-data 原版已随项目源码归档，部署运行的是版本可核验的 HTTP 适配器，不动态下载或执行 Skill。其余个人 Skill 不属于站点部署产物；换机器时需重新安装同版本，并更新这里的路径。
