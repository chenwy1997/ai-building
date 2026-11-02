# 固定10类属性知识选配验证

```bash
bun run category-attributes-governance:dictionary-trial --direct --budget=10
```

固定使用hardware60-reference-v2/trial-plan.json中的10类。新命令会创建一个付费试跑；只准备输入不调用模型可加`--prepare-only`。恢复用`--resume=run-...`，沿用已有预算账本和已成功响应，不能通过恢复提高原预算。模型名deepseek-flash，显式thinking disabled。

第一轮从工具族知识包选择ID/版本与填写策略，第二轮保留完整会话，对自己的选配检查遗漏、对象方向、重复和条件。两轮都使用JSON输出模式，完整响应通过本地schema、定义版本和单位校验。语法可编译不代表语义验收通过。每类最多两次正常请求，本轮不做循环重审，不调用京东或搜索工具。

工具族候选池由项目语义编写，含相邻属性作为干扰项；不从参考模板的selections或acceptance筛选答案。通用定义置于相同system前缀，工具族定义放在目标信息之前。第二轮完整追加第一轮输出和检查请求。缓存由服务商按前缀处理，不能保证100%命中；本地响应重放与服务端缓存分开计数。参考答案仅在运行后inspect.ts读入，作为差异定位和人工语义核对材料。

输出在workspace/output/dictionary-trial/run-...。manifest记录输入、代码指纹和预算；knowledge与initial-requests记录实际输入；results包含草稿和最终结果；usage与responses保存计费及恢复信息；trace逐请求留痕。不保存认证请求头或API Key。预算按Flash高峰价格保守预留，失败且费用不明时保留预留额。官方价格已于2026-09-15核对：https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ 。

预算计的是本次运行的模型请求，默认/最高10元。顺序执行以建立缓存前缀并便于检查；本轮不测最大吞吐。不会将结果自动覆盖正式参考库。

生成精确差异索引：

```bash
bun run src/scenarios/category_attributes_governance/dictionary/trial/inspect.ts run-...
```

差异索引不自动判定对错：等义定义、拆分或合并应由语义审核确认，填写条件的同义措辞不计错误。最终结论必须列出实际影响选型的遗漏、误配与条件错误；不能把返回JSON成功率冒充行业正确率。
