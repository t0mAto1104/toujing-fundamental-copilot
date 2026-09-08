# 项目开发 Skills

以下 Skill 用于 Codex 开发本项目，不是网站运行时的 AI 研究工具。

- `awesome-design-md`：界面设计或样式优化任务按需使用。入口为 `/Users/jerry_t0mato/.codex/skills/awesome-design-md/SKILL.md`；先读入口，再读选中的设计参考，不要全量加载资料库。
- `ponytail`：代码开发、修复和重构任务使用。入口为 `/Users/jerry_t0mato/.codex/skills/ponytail/SKILL.md`；先理解调用链，优先复用已有实现，以最小有效改动完成需求。

## 项目约束

- 本次接入没有选择新的品牌主题。保持现有中文界面、紧凑布局和日光／黑夜／跟随系统模式，除非用户要求改变。
- 精简实现不表示删减已有功能、安全校验、数据真实性保障、来源信息或必要测试。
- 不将这些开发 Skill 加入 `/api` 的模型提示词、collect/write 上下文或定时任务，不新增 API Key、后台服务、MCP 或自动更新任务。
- 仅安装或维护开发 Skill 不需要部署站点。业务代码改变时，仍按项目正常验证和发布流程执行。

## 固定上游版本

- [a-stock-data](https://github.com/t0mAto1104/a-stock-data)：v3.8.0，`15739a164c4f38c83738be24ec77672b3a031dbd`；本机入口 `/Users/jerry_t0mato/.codex/skills/a-stock-data/SKILL.md`。官方日历、北交所备用行情、指数成分/权重/估值、沪深两融适配为 HTTP＋D1，不运行其 Python 服务，不加入 AI 提示词。
- [awesome-design-md](https://github.com/t0mAto1104/awesome-design-md)：`8147538b4226ae41e2487a9179e3bcc1f68e8554`，已适配为本地设计资料 Skill。
- [ponytail](https://github.com/t0mAto1104/ponytail)：`2ed6c52c9d7e5e56942508591085fd45dea277d3`，只安装核心 Skill，做了 Codex 元数据、任务作用域及复用现有测试流程的兼容调整，没有安装插件 hooks。

上述路径是当前机器的个人 Skill 安装位置，不属于站点部署产物。换机器时需重新安装同版本 Skill，并更新这里的路径。
