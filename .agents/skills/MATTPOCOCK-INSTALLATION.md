# Matt Pocock skills 项目安装记录

- 来源：https://github.com/mattpocock/skills
- 固定版本：`49dd158d1076134a641b33efb035946536778336`
- 安装日期：2026-10-18
- 安装范围：本项目 `.agents/skills/`

| 技能 | 上游目录 | 安装原因 |
| --- | --- | --- |
| grill-me | skills/productivity/grill-me | 用户指定 |
| grill-with-docs | skills/engineering/grill-with-docs | 用户指定 |
| grilling | skills/productivity/grilling | 两个入口技能共同依赖 |
| domain-modeling | skills/engineering/domain-modeling | grill-with-docs 依赖 |

两个入口的 SKILL.md 各追加一条兼容说明：环境没有 Skill 工具时，直接读取并遵循相邻依赖的 SKILL.md。其余上游文件保持原样。domain-modeling 的 ADR 和术语表格式文件已一并安装。

在本项目的后续对话中可使用 `$grill-me` 或 `$grill-with-docs` 显式调用。本次仅安装，未启动访谈或创建业务术语表、决策记录。

许可证见各技能目录内 LICENSE。更新时需保留或重新应用上述入口兼容说明。
