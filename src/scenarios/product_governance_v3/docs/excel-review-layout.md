# 审阅Excel默认样式与冻结参数

2026-10-23。用户已确认“属性方案”第一页的紧凑样式作为默认。当前属性方案导出器的所有sheet和`--restyle`共用[默认配置](../scripts/review-layout.defaults.json)及[渲染函数](../scripts/review-workbook-layout.mjs)，业务生成脚本不分别维护字号、表头和行高。新建审阅导出应复用该入口；旧v2工作簿和历史事实导出器不因本次改动自动变更。

| 设置 | 默认 |
| --- | --- |
| 字体 | Arial；正文/表头10号，标题14号，顶部说明9号 |
| 数据行高 | 22px，即16.5磅；固定单行，不被长说明撑高 |
| 表头 | 28px，深蓝底白字，保留筛选 |
| 审阅输入 | 浅黄色，保留已填内容和下拉 |
| 长内容 | 单元格原值保留；超出单行时提供全文备注，带角标，可悬停查看。已有人工备注/评论保留 |
| 冻结 | 表头固定；默认固定左侧1列，可通过参数取消、改变列数或按列名确定边界 |

冻结是Excel原生的连续左侧区域。指定“冻结到无芯”，含该列及其左侧所有列；不会重排或移动业务列。当前第一页“属性”为A列，左侧1列即可。旧整体稿中“固定最左两列”为早期试排，后续以本次已确认默认及显式参数为准。

## 直接改参数

以下选项同时适用于新建导出和已有表重排，不需要改代码。运行环境及基础命令见[样板运行说明](roll-pilot-runbook.md)。

```sh
# 左侧固定1列，本次即属性列
"$PGV3_NODE" src/scenarios/product_governance_v3/scripts/export-roll-attribute-review.mjs --restyle /已保存的审阅表.xlsx /新的统一样式.xlsx --freeze-left 1

# 取消左侧冻结，仍固定表头
"$PGV3_NODE" src/scenarios/product_governance_v3/scripts/export-roll-attribute-review.mjs --restyle /已保存的审阅表.xlsx /新的统一样式.xlsx --freeze-left 0

# 仅此页冻结到“无芯”列，其他页沿用默认
"$PGV3_NODE" src/scenarios/product_governance_v3/scripts/export-roll-attribute-review.mjs --restyle /已保存的审阅表.xlsx /新的统一样式.xlsx --freeze-through '属性方案=无芯'

# 同一选项也适用于从本地材料新建工作簿
"$PGV3_NODE" src/scenarios/product_governance_v3/scripts/export-roll-attribute-review.mjs /本地样板目录 /新的导出目录 --freeze-left 1
```

特殊要求可用`--layout /本次配置.json`传入少量覆盖项，例如：

```json
{
  "sheets": {
    "属性方案": { "freezeThrough": "属性" },
    "补充与排除": { "freezeLeftColumns": 0 }
  }
}
```

优先级为共享默认、配置文件、命令行全表列数、命令行指定sheet列名。各sheet可以设置`rowHeightMode: "wrap"`显式展开多行；未指定时均为固定单行。页名、列名、列数或配置键错误会报错，禁止静默回退。输出不覆盖已有文件，重排保留值、公式、意见及下拉，不重跑治理任务。实际生效配置与冻结范围记录在导出索引或`xlsx.layout-edit.json`中。

该配置属于Excel展示层，不进入DeepSeek的商品事实或属性业务上下文，不改变冻结的类目定义和已审对象内容版本。

本次验收：121项v3回归和类型检查通过；实际新建导出验证第一页冻结A—C、其余页取消左侧冻结。三页保存值、意见及下拉与源表一致，数据行均为16.5磅，45条全文备注逐条对应原单元格。WPS小屏100%实看第一页及“定义与设置”的固定行显示；生成库PNG对固定高度的多行文本存在溢出，展示以WPS实测为准，不将PNG当作备注交互验收。
