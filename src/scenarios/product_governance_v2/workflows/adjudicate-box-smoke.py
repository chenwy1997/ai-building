"""Explicit Codex decisions for the frozen 2026-10-20 box-tissue smoke.

Offline only; not a reusable classifier or an automatic publication command.
Original model outputs and the 21-category delivery remain immutable.
"""
import copy
import hashlib
import json
from pathlib import Path

ROOT = Path("outputs/product-governance-v2/clean-paper-20261020")
CID = "c7e8d056-d834-4432-95a2-981e6e20e640"
BATCH = ROOT / "batches/pipeline-v1-smoke"
OUT = BATCH / "codex-adjudication"

def read(p):
    return json.loads(p.read_text())

def digest(x):
    text = x if isinstance(x, str) else json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()

def save(name, x):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(x, ensure_ascii=False, indent=2) + "\n")

new = read(BATCH / "categories" / CID / "result.json")
old = next(x for x in read(ROOT / "revisions/closure-r3/final-cards.json") if x["category"]["id"] == CID)
assert digest(new["card"]) == "6b52ba9d3aa4696ce35b02e59bf7b3637c4af18554609a99e38e7e6a6ea92435"
assert digest(old["card"]) == "5c4cbf1eb2c9558b8d19fdf497b7b2f25371abe64d66e0f5be47fed3ef6dd09a"
card = copy.deepcopy(new["card"])
sources = copy.deepcopy(new["sources"])
decisions = []
source = dict(id="codex-adjudication", kind="model_knowledge", platform="Codex",
              locator=str(OUT / "decisions.json"), text="Codex逐项业务裁定；不是外部商品事实",
              hash=digest("Codex逐项业务裁定；不是外部商品事实"),
              retrievedAt="2026-10-20", mode="explicit_adjudication")
sources.append(source)

def item(group, id):
    return next(x for x in card[group] if x["id" if group == "attributes" else "attributeId"] == id)

def decide(id, action, reason):
    original = next((x for x in new["card"]["attributes"] if x["id"] == id), None)
    decisions.append(dict(attributeId=id, originalName=original["name"] if original else None,
                          action=action, reason=reason))
    if action != "移出类目属性" and action != "保留":
        item("provenance", id)["claims"].append(dict(sourceId="codex-adjudication", relation="修订",
                                                   claim=reason, quote=""))

def examples(*triples):
    return [dict(input="synthetic："+a, expected=b, reason=c) for a,b,c in triples]

for id, reason in [
    ("common.brand", "保留明确品牌原文，不把渠道名或店铺名当品牌；品牌库归一化不属于本次缺陷。"),
    ("ply_count", "精确正整数层数、范围值不当精确值的口径正确。"),
    ("embossed", "压花独立于印花，正确限定纸张本体且缺证不默认否。"),
    ("printed", "印花独立于压花，包装图案不能作为纸张印花证据。"),
]:
    decide(id, "保留", reason)

item("bindings","common.model").update(valueLevel="SKU",
    scope="当前SKU厂商标注的型号/货号；仅有证据证明同SPU全部SKU一致时才向上归并")
decide("common.model","修订","定义不变，型号/货号可能随规格变化，绑定改为SKU；合并文本保留标签符合现行范围。")

item("attributes","primary_use").update(name="适用场景",
    definition="商品明确宣称的使用环境，如家用、办公、酒店餐饮、商用；不承载面巾纸/餐巾纸等纸品类型。",
    describes="当前SKU宣称的使用环境", enumValues=["家用","办公","酒店餐饮","商用"],
    excludedMeanings=["纸品类型","类目归属证明","材质或包装结构"],
    enumPolicy="可多选，用中文分号分隔；只填原文明确场景，不由酒店自动再填商用。枚举外明确值保留原文候选，缺证不填其他。")
item("bindings","primary_use").update(requiredness="optional", valueLevel="SKU",
    rationale="环境场景有搜索价值，但不决定盒装面巾纸身份；因原定义混入对象类型而重新划定职责，不是因缺证降级。")
item("rules","primary_use").update(
    directRule="只提取明确使用环境，不将面巾纸、餐巾纸等对象名填入场景，也不从类目推断家用。",
    onConflict="多个明确场景可共存，逐项保留；互相否定的适用声明则记录冲突。",
    examples=examples(("酒店用盒装抽纸","酒店餐饮","原文明示环境"),("盒装纸面巾200抽","缺证","产品类型不等于环境")))
decide("primary_use","修订","主要用途混合纸品类型与使用环境，拆清语义为可选适用场景；归类职责由单列边界检查承接。")

item("bindings","sheets_per_pack").update(requiredness="conditional",
    condition="当前SKU为同质独立盒装组合时必填；异规格组合按组件记录，不均摊；组合结构未知标记适用性待确认")
decide("sheets_per_pack","修订","保留抽与张独立和直接提取；改为同质组合条件必填，异规格不能强制一个单盒数。")

item("rules","packs_per_bundle").update(
    onMissing="已确认有提级包装但无盒数为missing；提级是否存在不明为applicability_unknown；明确无提级才not_applicable。",
    directRule="提取提级包装内明示盒数，盒按独立包计；已确认提级但未写数量仍计条件必填缺项。")
decide("packs_per_bundle","修订","纠正“不能推出就不必填”：数量缺失与包装层级不适用必须区分。")

item("bindings","packaging_spec").update(valueLevel="SKU")
decide("packaging_spec","修订","保留为销售规格原文的展示字段，改为SKU；结构化数量仍单独记录，不参与重复必填。")

decide("measure_unit","移出类目属性","来自外部模板的交易主数据字段；未给出与销售单位不同的转换定义，不应作为纸品特性重复生成。保留在商业主数据对接待办。")
for group in ["attributes","bindings","rules","provenance"]:
    key="id" if group=="attributes" else "attributeId"
    card[group]=[x for x in card[group] if x[key]!="measure_unit"]

item("rules","sales_unit").update(
    directRule="优先取该SKU订单/报价中明确计价销售单位；只写每箱含几盒不能证明按箱售卖，需交易单位或一销售件范围证据。",
    preconditions=["单位描述当前SKU报价或订单交易单元，不是内层包装比率"],
    examples=examples(("报价单位：箱；每箱8盒","箱","交易单位明确"),
                      ("规格：8盒/箱；未给报价或销售件单位","缺证","装箱比率不证明交易单位")))
decide("sales_unit","修订","字段可保留，但8盒/箱只是包装比率；不再仅凭外层单位推断订单销售单位。")

item("bindings","is_set").update(valueLevel="SKU")
item("rules","is_set").update(
    directRule="完整销售组合明确为同规格同品多盒时填否；明确不同规格或不同商品搭配时填是；组合内容不清留空，不要求出现非套装三字。",
    examples=examples(("完整销售规格：同款100抽×6盒","否","明确同质组合"),
                      ("销售规格：盒装抽纸6盒+湿巾2包","是","不同商品组合")))
decide("is_set","修订","修正过度保守：完整同质规格能判否；混合规格/多品能判是，不能将同质多包一律缺证。改为SKU。")

item("bindings","set_composition").update(valueLevel="SKU")
item("attributes","set_composition").update(
    definition="是否套装为是时，记录实际销售组合中的组件名称、规格和数量；不得编造组件，也不得删掉非纸品真实组件。",
    excludedMeanings=["同质多盒常规规格","从参考模板复制的非本商品示例"])
item("rules","set_composition").update(
    directRule="is_set为是时记录全部明确组件和数量；为否则不适用；组合性质未知时标适用性待确认。混入他品类另核主商品归属。",
    onMissing="已确认套装但组件缺失为missing；是否套装未知为applicability_unknown；非套装为not_applicable。")
decide("set_composition","修订","不照搬震坤行洗护示例，但真实组合若含其他品类不能丢失；按SKU并区分三种缺项状态。")

item("attributes","sheet_size").update(name="纸张尺寸",
    enumPolicy="文本值用长×宽，unit固定mm。原文cm可按1cm=10mm逐边换算并保留原文；未知单位不推测。")
item("rules","sheet_size").update(
    directRule="提取单张纸展开长宽；mm直接保留，cm逐边乘10转换为mm，记录原文与换算；不使用盒体尺寸。",
    preconditions=["对象为单张展开纸面","两个边长及单位明确","cm到mm仅作精确单位换算，非包装数量反推"],
    examples=examples(("纸张展开19×13cm","190×130","单位mm；逐边乘10"),
                      ("包装盒19×13×8cm","缺证","对象不对，不能替代纸面")))
decide("sheet_size","修订","改回清晰的纸张尺寸；删掉单位固定mm却不许换算的限制，规范cm→mm，避免把19cm误写19mm。")

item("bindings","package_form").update(requiredness="always",
    rationale="单盒容器形态是区别软包与盒装的核心身份；不因当前样本缺证而降级。")
item("attributes","package_form").update(name="包装形式",
    enumPolicy="单盒容器形态，单选。盒装为本类合格形态；软包塑装输出错挂证据，不当作本类合格值；其他须附明确形态原文，缺证不填其他。")
item("rules","package_form")["examples"]=examples(
    ("盒装抽纸200抽×12盒","盒装","明确盒装"),
    ("三层塑装纸面巾6包","软包塑装；wrong→软包抽纸","有反证应判错挂，不能只标待确认"))
decide("package_form","修订","恢复核心必填，替代旧版是否盒装的重复展示字段；明确软包为wrong，而非所有不合格都uncertain。")

item("attributes","total_packs").update(name="销售总包数",
    definition="一个完整销售组合中的独立纸盒总数，盒作为包计。直接总数优先；否则可用同一外层的每提/箱包数乘提/箱数。",
    enumPolicy="正整数。只在同SKU、同销售组合、同层级独立明示因子且范围清楚时乘法计算；不循环派生。")
item("rules","total_packs").update(
    directRule="直接销售总包数优先。无直接值时，每提包数×提数或每箱包数×箱数，必须同一层级；本字段不实现总抽数除以每包抽数。",
    inputs=[dict(name="每外层包数",unit="包/同一外层单位",scope="独立明示的包/提或包/箱"),
            dict(name="销售外层件数",unit="对应外层单位",scope="同SKU同销售组合中独立明示的提数或箱数")],
    formula="每外层包数 × 销售外层件数",
    preconditions=["同SKU同销售组合", "完整同质规格且无未解赠品/混装冲突",
                   "两个因子均为独立直接观测，不能由待求总数反推",
                   "包/提仅乘提数，包/箱仅乘箱数；不能混层",
                   "因子和结果为正整数；乘法不要求除法的可整除条件"],
    onMissing="无直接值且任一因子缺失则missing；未实现的除法反推不执行。",
    onConflict="直接值与计算值一致保留直接来源；不一致记录conflict，不能任选一个。",
    examples=examples(("完整销售规格：3层136抽×36盒/箱×10箱","360","36×10；抽数与层数不参加"),
                      ("完整销售规格：每箱36盒×10提","缺证","箱与提不同层级，不能36×10"),
                      ("每提3盒×5提；合计12盒","冲突","计算15与直接12冲突，不择一")))
decide("total_packs","修订","补回箱级乘法、独立直接输入与直接/计算冲突处理；驳回审核对乘法强求可整除及漏读已有合成标签。")

item("attributes","scent").update(
    definition="纸张本身明确宣称的香型本义；保留最具体已知香型，不从系列名、包装图案推断。",
    enumValues=["无香","花香","薰衣草香","果香","茶香","绿茶香","柠檬香","奶香","有香（具体香型未明）"],
    enumPolicy="同质SKU单选。原文已有具体值就选具体值，不再派生花香/果香等上位标签；原文仅写上位词才取上位值。只知有香时填有香（具体香型未明），未知不默认无香。异香组合按组件记录。枚举外原文保留候选，不塞其他。")
item("rules","scent").update(
    directRule="按商品明示香型本义填值；明确柠檬香即填柠檬香，薰衣草香即填薰衣草香；不将已知具体香型降为上位词。",
    preconditions=["描述纸张本身香型，不是系列名或盒体图案"],
    examples=examples(("柠檬香盒装抽纸","柠檬香","正式枚举中已有此值"),
                      ("薰衣草香盒装抽纸","薰衣草香","不同时填花香"),
                      ("有香型，未说明香味","有香（具体香型未明）","与缺证不同"),
                      ("原木纯品盒装抽纸","缺证","系列名不证明无香或材质")))
decide("scent","修订","真实缺陷是枚举、策略、反例不一致；柠檬香与花香交叉的审核说法不成立。采用本义具体值优先，保留有香未明并恢复旧版未覆盖的取值。候选枚举不冒充本类商品证实。")

# Restore two independently useful concepts; do not copy old faulty requiredness or sample acceptance.
for oldid,id,name in [
    ("cat.tissue.sheet_pieces_per_pack","pieces_per_pack","每包张数"),
    ("cat.pkg.packs_per_box","packs_per_case","每箱包数"),
]:
    for group in ["attributes","bindings","rules","provenance"]:
        key="id" if group=="attributes" else "attributeId"
        part=copy.deepcopy(next(x for x in old["card"][group] if x[key]==oldid))
        part[key]=id
        if group=="provenance":
            part["claims"]=[dict(sourceId="codex-adjudication", relation="提出",
                claim="对比旧卡发现独立计量概念遗漏，按本次裁定恢复；不引用旧样本为本类事实。",quote="")]
        card[group].append(part)
    if id=="pieces_per_pack":
        item("bindings",id).update(requiredness="optional",condition="",
            rationale="独立保留张数口径作展示和来源核验；不强制用抽数×层数补张数。核心每包抽数仍按组合条件必填，非因缺数据降低它。",
            scope="当前SKU同质单盒纸页张数；异规格组合按组件记录")
    else:
        item("rules",id).update(onConflict="不同来源每箱包数不一致则冲突；每箱包数与销售总包数不同本身不是冲突，需核对箱数。",
            onMissing="箱级存在但数量不明为missing；箱级存在性不明为applicability_unknown；明确没有箱级为not_applicable。")
    decide(id,"补回遗漏","抽与张不可互换，需独立保留。" if id=="pieces_per_pack" else "每箱包数不同于每提包数和销售总包数；已有明确盒装样本支持箱级字段。")

# Read existing raw evidence, not historic property values. No requests.
target_path=ROOT/"revisions/closure-r3/small-trial-five/targeted"/(CID+".json")
targeted=read(target_path)["products"]
positive_ids=["f5830fe8-5865-4681-a9f5-ea25cbd8a279","fee07a40-b48a-48c5-a215-262343a597bf",
              "edc6e8f4-0b2f-4c8d-8aa7-597b7060d5ab","ade71556-aad2-44a1-83bd-df746a6d861c"]
positives=[next(p for p in targeted if p["id"]==id) for id in positive_ids]
for p in positives:
    text="标题："+p["title"]+"\n销售规格："+p["saleSpec"]
    sources.append(dict(id="raw-"+p["id"],kind="product_sample",platform="三横ES/详情原始快照",
        locator=str(target_path.resolve())+"#"+p["id"],text=text,hash=digest(text),
        retrievedAt=p["detailFetchedAt"],mode="codex_read_existing_raw_text"))
card["attributes"].append(dict(id="paper_material",name="纸浆材质",kind="类目特性属性",
    definition="纸张本体明确标注的纸浆原料；保留原生等限定词，不指包装纸盒材质，不从系列名推断。",
    describes="纸张本体原料",fieldType="文本",unit="",excludedMeanings=["纸盒材质","原木纯品等系列名","仅凭颜色推断竹浆"],
    enumValues=[],enumPolicy="先以文本保留准确原料宣称；原生木浆不截为木浆，未提供成分比例不臆造，后续积累真实值再评估枚举化。"))
card["bindings"].append(dict(attributeId="paper_material",requiredness="optional",condition="",valueLevel="SKU",
    scope="当前SKU纸张本体",uses=["展示","搜索","筛选"],rationale="原料对产品比较有价值，已有原生木浆样本支持；不能从品牌或系列名推断。"))
card["rules"].append(dict(attributeId="paper_material",directRule="取纸张本体明确原料宣称；保留原生及含量限定，不从系列名推定。",
    operator="direct",inputs=[],formula="",preconditions=["描述对象是纸张本体"],
    onMissing="无明确原料宣称为缺证。",onConflict="不同原料表述有实质矛盾时记录冲突，成分与泛称兼容时保留更具体原文。",
    examples=examples(("纸张原料：原生木浆","原生木浆","保留限定词"),("原木纯品盒装纸巾","缺证","系列名不是成分证据"))))
card["provenance"].append(dict(attributeId="paper_material",claims=[dict(
    sourceId="raw-edc6e8f4-0b2f-4c8d-8aa7-597b7060d5ab",relation="支持",
    claim="明确盒装商品标题有原生木浆宣称，支持增设独立纸张原料字段。",quote="原生木浆")]))
decide("paper_material","补充共同遗漏","新旧两版都缺纸浆材质；已有明确盒装商品原生木浆原文支持，非关闭思考独有遗漏。")
item("provenance","packs_per_case")["claims"].append(dict(
    sourceId="raw-edc6e8f4-0b2f-4c8d-8aa7-597b7060d5ab",relation="支持",
    claim="独立箱内盒数与销售箱数须分开。",quote="(3层136抽*36盒)*10箱"))

for d in card["dimensions"]:
    d["attributeIds"]=[id for id in d["attributeIds"] if id!="measure_unit"]
    if d["name"]=="材料结构":d["attributeIds"].append("paper_material")
    if d["name"]=="包装计量":d["attributeIds"]+=["pieces_per_pack","packs_per_case"]
card["boundary"]["includes"]="具有单盒抽取口的盒装干态纸面巾；盒体为使用包装，不以运输箱证明盒装；纸品类型、抽取方式、单盒形态分别核对。"
card["unresolved"]=["本类代表商品与枚举尚未穷尽，运营继续抽检；本次未做全类商品验证或思考档位对照实验。"]
assert len(card["attributes"])==19 and len(decisions)==20

# Every original field has a decision. Model outputs stay immutable.
assert {d["attributeId"] for d in decisions} >= {a["id"] for a in new["card"]["attributes"]}
boundary_checks=[
    dict(legacyId="cat.box_tissue.is_boxed",target="package_form + 类目归属结果",
         disposition="合并重复展示字段",rule="单盒为盒装才符合；运输箱不算；形态未知为uncertain。"),
    dict(legacyId="cat.tissue.usage_type",target="类目边界检查",
         disposition="转归类检查而非场景替代",rule="对象必须干态纸面巾；湿巾、擦手纸、厨房纸等按真实对象判相邻类目。"),
    dict(legacyId="cat.tissue.is_pullout",target="类目边界检查",
         disposition="转归类检查",rule="必须抽取式；卷纸、平板纸明确排除。"),
]
sample=read(BATCH/"samples"/(CID+".json"))
wrong_ids={"f77d7020-fae9-4e72-86b0-5a448b5f208d","ac10b8b3-75db-4987-bff6-f1179d1ccc9e","cec45a49-9511-4118-9300-3d76ee8f48dc"}
sample_decisions=[]
for p in sample["products"]:
    wrong=p["id"] in wrong_ids
    sample_decisions.append(dict(productId=p["id"],title=p["title"],saleSpec=p["saleSpec"],
        oldDecision=next(x["status"] for x in old["sampleDecisions"] if x["productId"]==p["id"]),
        newModelDecision=next(x["status"] for x in new["sampleDecisions"] if x["productId"]==p["id"]),
        codexDecision="wrong" if wrong else "uncertain",
        reason="明确塑装纸面巾，符合软包抽纸边界。" if wrong else "无单盒包装证据；只缺层数/抽数不能作为错类理由。",
        targetCategory="软包抽纸" if wrong else None,
        targetCategoryId="fd7a6576-b4bb-4ef0-a273-9de18cf571a2" if wrong else None))
evidence_checks=[
    dict(productId=positive_ids[0],expected={"package_form":"盒装","ply_count":2,"sheets_per_pack":200,"packs_per_case":12,"total_packs":12},
         reason="标题盒抽、200抽/盒、12盒整箱装；整箱为该完整销售规格。"),
    dict(productId=positive_ids[1],expected={"package_form":"盒装","ply_count":2,"sheets_per_pack":200,"packs_per_case":36,"total_packs":36},
         reason="黑白修饰硬盒，不能填为纸张颜色；200抽不能乘2层当400抽。"),
    dict(productId=positive_ids[2],expected={"package_form":"盒装","paper_material":"原生木浆","ply_count":3,"sheets_per_pack":136,"packs_per_case":36,"total_packs":360},
         reason="36盒/箱×10箱=360盒；每箱36与销售总数360不是冲突；不改写为每盒1360抽。"),
    dict(productId=positive_ids[3],expected={"package_form":"盒装","ply_count":3,"sheets_per_pack":100,"packs_per_bundle":3,"total_packs":15},
         reason="3盒×5提与共15盒一致，保留明确总数。"),
]
for row in evidence_checks:
    p=next(p for p in positives if p["id"]==row["productId"])
    row.update(title=p["title"],saleSpec=p["saleSpec"],sourceId="raw-"+p["id"],
               evaluation="Codex对现存原文做静态规则核验；非本次DeepSeek试填结果")

mapping={
    "cat.box_tissue.is_boxed":"package_form + boundary","cat.tissue.usage_type":"boundary","cat.tissue.is_pullout":"boundary",
    "common.brand":"common.brand","common.model":"common.model","cat.tissue.ply_count":"ply_count",
    "cat.tissue.sheet_size":"sheet_size","cat.tissue.is_embossed":"embossed","cat.tissue.is_printed":"printed",
    "cat.tissue.sheets_per_pack":"sheets_per_pack","cat.tissue.sheet_pieces_per_pack":"pieces_per_pack",
    "cat.tissue.fragrance_type":"scent","cat.pkg.pack_form":"package_form","cat.pkg.total_pack_count":"total_packs",
    "cat.pkg.is_set":"is_set","cat.pkg.packs_per_tier":"packs_per_bundle","cat.pkg.packs_per_box":"packs_per_case",
}
old_comparison=[dict(oldId=a["id"],oldName=a["name"],target=mapping[a["id"]],
    result="原候选遗漏，已补回" if a["id"] in {"cat.tissue.sheet_pieces_per_pack","cat.pkg.packs_per_box"}
           else "合并/边界检查" if a["id"] in {x["legacyId"] for x in boundary_checks} else "语义映射，详见逐项裁定")
    for a in old["card"]["attributes"]]
review_decisions=[
    dict(issue="提数未登记",decision="驳回误报",reason="已有inputs明确列每提包数及提数；需要加强独立同层级前提，不是缺字段。"),
    dict(issue="示例未标synthetic",decision="驳回误报",reason="候选示例已写合成示例/合成测试；英文单词不是唯一合法标记。"),
    dict(issue="柠檬香与花香交叉",decision="驳回理由，采纳一致性问题",reason="不能据此删除柠檬香；真实问题是正式枚举和枚举外反例矛盾，以及具体值/上位词选择不确定。"),
    dict(issue="dimensions覆盖错误",decision="已解决",reason="第二轮修复已将17项逐一归组；补项后重新校验19项覆盖。"),
    dict(issue="型号/货号必须拆分、品牌别名",decision="不作为阻断",reason="现行设计允许合并并保留标签；别名库是独立后续范围。"),
]
source_efforts={}
for label,p in [("baseline",ROOT/"revisions/closure-r3/categories"/CID/"cards.json"),
                ("candidate",BATCH/"categories"/CID/"cards.json")]:
    stage=read(p);req=read(ROOT/"calls"/stage["callHash"]/"request.json")
    source_efforts[label]=dict(callHash=stage["callHash"],model=req["body"]["model"],reasoning=req["body"].get("reasoning"))
save("final-card.json",dict(category=new["category"],card=card,cardHash=digest(card),sources=sources,
    status="codex_adjudicated_pending_operations",baseCandidateHash=new["cardHash"],comparisonBaselineHash=old["cardHash"],
    boundaryChecks=boundary_checks,publication="隔离裁定版；未替换21类正式交付卡或生产数据"))
save("decisions.json",dict(decisions=decisions,oldComparison=old_comparison,reviewDecisions=review_decisions,
    sourceEfforts=source_efforts,limitations=["两份初始完整卡请求都为none，不是开/关思考A/B。",
        "旧卡含多轮人工修订，新卡为独立生成；提示词、样本采纳与流程不同，不能把差异归因于思考档位。"],
    standardConflict="冻结标准07允许香型上位归并，但旧交付卡采用具体本义；本次明确采用具体值优先并留版本差异，历史标准不覆盖。"))
save("sample-decisions.json",dict(originalRandom=sample_decisions,additionalExistingRaw=evidence_checks,
    countNote="随机10件：0明确匹配、3明确错挂、7待确认；另复用4件已存定向正样本静态核验，不能合并宣称随机准确率。"))
save("metadata-handoff.json",dict(attributeId="measure_unit",status="deferred_commercial_metadata",
    reason="保留来源4188及原候选定义；若未来有独立基准单位/销售单位换算模型，再在商业主数据层接入。",
    originalAttribute=next(a for a in new["card"]["attributes"] if a["id"]=="measure_unit")))
save("status.json",dict(status="codex_adjudicated_pending_operations",categoryId=CID,
    originalCandidateCount=17,retainedUnchanged=4,revised=12,removedToMetadata=1,added=3,finalCount=19,
    finalCardHash=digest(card),baseCandidateHash=new["cardHash"],additionalApiCalls=0,
    changedBaseline=False,changedExcel=False))

table="\n".join("|"+str(i)+"|"+(d["originalName"] or item("attributes",d["attributeId"])["name"])+"|"+
    d["action"]+"|"+d["reason"]+"|" for i,d in enumerate(decisions,1))
oldtable="\n".join("|"+d["oldName"]+"|`"+d["oldId"]+"`|`"+d["target"]+"`|"+d["result"]+"|" for d in old_comparison)
finaltable="\n".join("|"+a["name"]+"|`"+a["id"]+"`|"+a["fieldType"]+"|"+
    item("bindings",a["id"])["requiredness"]+"|"+item("bindings",a["id"])["valueLevel"]+"|"+
    a["definition"]+"|" for a in card["attributes"])
report=f"""# 盒装抽纸：无思考候选裁定与旧卡对比

日期：2026-10-20。类目：清洁用品 > 清洁纸品 > 卫生纸 > 盒装抽纸。ID：`{CID}`。

## 结论

**新候选有实质遗漏和规则缺陷，修订后可作为待运营审核的19项属性卡；不能据此认定关闭思考导致质量下降，也不能认定无思考已与高思考等质。**

实际请求记录中，旧版初始完整卡和新版初始完整卡均使用 `deepseek-flash`、`reasoning.effort=none`。旧版还经历了人工修订、命名治理等环节；新旧提示词、来源采纳和生成流程不同。这是两个产物的比较，不是思考档位的受控实验。

- 优化代码已提交：`7540e95d17`；分支 `codex/product-governance-v2-20261020`，新批量入口默认固定并发32，可显式调整。
- 旧交付卡17项，新候选17项，数量相同但语义覆盖不同。
- 本次对17项全部作出决定：原样保留4项、修订12项、移到商业主数据待办1项；另补回2项遗漏、补充1项共同遗漏，得到19项。
- 原候选JSON、旧21类属性卡和Excel均保留；裁定稿在本目录独立保存，尚未发布线上。
- 本轮只读取现存请求、卡片及原始商品快照，没有新增API调用，没有重跑21类。

## 主要缺陷与处置

1. **计量概念遗漏**：新候选缺“每包张数”“每箱包数”。抽、张不能互换；每箱包数不等于销售总包数，均补回。每包张数作为补充计量口径可选，核心每包抽数仍按同质组合条件必填，不使用层数乘抽数来补张数。
2. **材质共同遗漏**：两版都没有纸浆材质。现存正样本明确宣称“原生木浆”，据此补充；先文本保留原料限定词，不臆造完整枚举。
3. **香型规则矛盾**：柠檬香已在枚举中，反例却要求当枚举外；有香但具体不明也缺承接。修订为具体本义优先、仅有上位词时保留上位词、缺证不默认无香。“柠檬香与花香交叉”的审核理由驳回。这里明确收紧冻结标准07允许上位归并的口径，留版本差异，不声称旧标准原本一致。
4. **数量和单位规则缺陷**：总包数只写提级乘法，缺箱级；尺寸固定mm却写“不换算”；提级存在但缺数量被降成不必填。已分别补箱级公式、精确cm→mm换算、条件必填三态。
5. **绑定层级不合适**：型号/货号、包装规格、是否套装、组合明细可能随SKU不同，改为SKU。包装形式恢复核心必填；适用场景独立于纸品类型，作为可选检索字段。
6. **机械采纳参考字段**：标品计量单位与销售单位没有明确的差异及转换模型，移到商业主数据待办；保存原字段和震坤行来源，未丢弃。销售单位不能只凭8盒/箱推断，装箱比率不等于报价单位。

旧卡“是否盒装”“纸品类型”“是否抽取式”不照搬为三列重复信息，前者由包装形式和归属结果承接，后两者明确转入边界核验项（见final-card.json的boundaryChecks）。**这是本次显式裁定的分工，不是宣称原新候选已经覆盖了全部旧字段。**当前边界检查仍需语义审核执行，不是已经实现通用确定性分类器。

## 原17项逐项裁定

|序号|原属性名/新增属性名|裁定|原因与修改|
|---:|---|---|---|
{table}

## 与旧卡逐项映射

以下映射用于比较，未执行生产属性ID迁移。非公共属性仍按类目ID和属性ID共同定位。

|旧属性名|旧ID|裁定稿对应项|处置|
|---|---|---|---|
{oldtable}

## 样本核查：旧版也有误判

同一批随机10件，旧版标8件matched、2件uncertain，但其中8件的理由仍承认“盒装形态待核实”。新版全部uncertain，避免了这类误接纳，不过又漏判3件明确塑装商品。

本次Codex结果：**0件明确匹配、3件明确错挂、7件待确认**。这不代表类目没有商品，也不能外推总体错挂率。

- `f77d7020-fae9-4e72-86b0-5a448b5f208d`：心相印DT15110“三层塑装纸面巾8包×3提”。旧版matched不成立；本次判错挂，目标软包抽纸 `fd7a6576-b4bb-4ef0-a273-9de18cf571a2`。
- `ac10b8b3-75db-4987-bff6-f1179d1ccc9e`、`cec45a49-9511-4118-9300-3d76ee8f48dc`同样明示塑装，给出同一V2目标。其余仅没写盒装的商品不凭猜测改类目。
- 缺层数、每包抽数不能单独作为类目待确认依据；判断应围绕对象、抽取方式、单盒容器形态。

另外从此前已保存的定向补样原文中取4件明确盒装商品做静态核验，**未输入到本轮原始模型生成，不冒充新的随机样本或DeepSeek试填**：

|商品源ID|原文关键内容|Codex核验|
|---|---|---|
|f5830fe8-5865-4681-a9f5-ea25cbd8a279|2层200抽/盒，12盒整箱装|每包200抽、每箱12盒；不能把总抽数当每盒数|
|fee07a40-b48a-48c5-a215-262343a597bf|黑白硬盒、2层200抽、36盒整箱|黑白修饰盒体，不能当纸张颜色；每箱36盒|
|edc6e8f4-0b2f-4c8d-8aa7-597b7060d5ab|原生木浆、盒装抽纸(3层136抽×36盒)×10箱|材质原生木浆；每箱36、销售总包数360、每包136抽|
|ade71556-aad2-44a1-83bd-df746a6d861c|盒巾100抽3盒×5提，共15盒|3×5=15与直接总数一致，保留直接来源|

上述核验为本地原文和规则的人工实证检查，不是重新运行商品填写流程，也不提供填充率/准确率。

## 裁定后属性卡概览

完整定义、枚举、绑定、公式、正反例及来源在final-card.json。always=必填，conditional=按业务条件必填，optional=可选；不以资料缺失代替适用性。

|属性名|ID|类型|必填性|值层级|定义|
|---|---|---|---|---|---|
{finaltable}

## 下一步判断

继续保留none和默认并发32。此次发现的漏洞更直接指向**维度覆盖、计量层级清单、示例与规则一致性、正样本充分性和审核误报**，不能只靠提高思考档位解决。

在下一次实际新增类目任务前，应把本次“抽/张独立、提/箱独立、具体香型优先、交易单位不等于包装单位”等已裁定规则纳入新的标准版本；对材料维度做明确检查，缺有效正样本时保留限制。旧批标准不原地重写。是否需要开思考应另用相同输入/提示/样本的受控小批实验判断，本次没有为做对照再付费生成。

本稿完成Codex裁定，待运营审核；代表商品和枚举覆盖仍非穷尽。没有把整个21类批次重跑，也没有将本稿自动覆盖旧交付。

证据文件：decisions.json、sample-decisions.json、metadata-handoff.json、final-card.json、validation.json。
"""
(OUT/"盒装抽纸候选属性裁定与旧卡对比.md").write_text(report)
print(json.dumps(dict(output=str(OUT),original=17,adjudicated=len(decisions),final=19,additionalApiCalls=0),ensure_ascii=False))
