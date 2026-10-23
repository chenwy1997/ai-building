// Shared by preflight and the exporter: validate the exact headers that will be written.
export const BATCH_REVIEW_SHEETS = [
  {
    name: "属性方案", key: "attributes",
    headers: ["属性", "末级类目", "填写要求", "类型 / 单位", "业务用途与理由", "审阅结论", "审阅意见", "完整定义", "填写要求理由", "末级差异理由", "同族", "完整类目路径", "属性ID", "概念", "计量对象", "完整配置", "依据"],
    widths: [135, 125, 75, 100, 270, 100, 240, 350, 280, 280, 200, 420, 240, 240, 260, 480, 480],
    editable: [5, 6], decision: 5, preview: "A1:F12",
    note: "审属性是否该设、定义、填写要求和同族差异；黄色列填意见，空白表示未审。",
  },
  {
    name: "扩展候选", key: "extensions",
    headers: ["候选属性", "末级类目", "暂缓原因", "审阅结论", "审阅意见", "潜在用途", "启用条件", "完整类目路径", "候选ID", "依据"],
    widths: [135, 125, 270, 100, 240, 270, 320, 420, 240, 480],
    editable: [3, 4], decision: 3, preview: "A1:E12",
    note: "这些概念尚未建为属性，不属于SKU填写合同；核实用途后另提共享修订。",
  },
  {
    name: "进度与问题", key: "issues",
    headers: ["末级类目", "执行状态", "阻断或待核实事项", "审阅意见", "属性数", "同族", "阻断类型", "完整类目路径", "类目ID", "运行记录", "规则版本"],
    widths: [135, 170, 360, 240, 70, 200, 170, 420, 330, 440, 440],
    editable: [3], decision: null, preview: "A1:D12",
    note: "覆盖本次全部末级，包括失败；阻断的原始方案保留JSON，不混入可审属性表。",
  },
];
