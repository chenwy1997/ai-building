import {join,resolve} from 'node:path';
import {read,save,digest} from '../runtime/storage.ts';
const root=resolve(import.meta.dir,'../../../..'), dir=join(root,'outputs/product-governance/three-category-20261019');
const legacy:any=await read(join(root,'outputs/clean-paper-remaining-20261016/attribute-model-all21.json'));
const categories=legacy.categories.filter((c:any)=>['软包抽纸','湿纸巾','纸巾盒'].includes(c.name)).map((c:any)=>({id:c.id,name:c.name,path:c.path,boundary:c.name==='软包抽纸'?'软包装干抽取面巾纸；排除湿巾、擦手纸、盒装抽纸、手帕纸及卷纸。':c.name==='湿纸巾'?'预浸液的湿巾，含已承接的湿厕纸、厨房及物体表面清洁湿巾；用途需单独标明。排除干棉柔巾和仅写干湿两用的干巾。':'可重复使用的完整纸品容器/分配器，包含完整卷纸盒、擦手纸盒；单独替换轴、支架、钥匙等归专用配件；纸本体不属于本类。'}));
const definitions:any[]=[];const bindings:any[]=[];
function add(id:string,name:string,type:string,unit:string,definition:string,rule:string,extra:any={}){
 definitions.push({id,name,type,unit,definition,rule,kind:id.startsWith('common.')?'公共属性':'类目特性属性',version:1,sourceTypes:['既有治理知识库','模型独立建议','Codex规则修订'],...extra});
}
function bind(cat:string,ids:string[],required:string[]){const c=categories.find((x:any)=>x.name===cat)!;for(const id of ids)bindings.push({categoryId:c.id,attributeId:id,required:required.includes(id),level:'SKU',applicability:'确认属于本类的商品',rationale:required.includes(id)?'影响品牌识别、数量比较或使用适配，是本轮核心字段。':'用于展示与筛选；未提及保留缺项，不以否或默认值替代。'});}
add('common.brand','品牌','选项','','当前销售商品自身品牌；不等同于供应商、适配设备或系列。','精确名称/别名匹配参考品牌字典；国产、通用、未知、无、N/A均不是品牌。只有明确自称无品牌才允许无品牌。标题中明确自身品牌但字典没有时保留枚举候选。',{dictionary:'brand-reference',selection:'单选',origin:'pilot-v2/common.brand；本轮扩展ES品牌参考项，仍需生产品牌主数据校验'});
add('common.model','型号/货号','文本','','当前SKU明确的厂商型号或货号。','保留字母、数字、连字符；上游SKU/平台编码和包装数量不是厂商型号。不能把标题首个数字自动视作型号。');
add('common.pack','销售包装组成','文本','','当前销售SKU的内外包装数量、计量单位、主体和赠品组成。','每包数量、包/盒/卷数及单位逐层记录；含赠品或混规格逐项列出；仅有一层信息也照实保留，不补猜。');
const perPack='优先取明确内包装数；只有同规格、同一销售单元、总量和包数均有证据、赠品剔除且整除时，才用总量÷包数。必须输出计算式与两条证据。总量、层数、张数不得冒充抽数/片数；抽/张/片不默认互换。仅“80抽”且未指明整组时可结合80抽×N包的重复单包语法；只写总量不能猜。';
add('soft.draws','每包抽数','数值','抽/包','单个软包内可抽取的次数。',perPack,{operator:'positive_integer_per_pack',formula:'总抽数/同规格包数',legacyCode:'B71-01'});
add('soft.layers','层数','数值','层','单次抽出的纸叠合层数。','须有“X层”的直接证据；不能乘入抽数，张数÷抽数只能有明确展开说明时使用。',{operator:'positive_integer',legacyCode:'B71-02'});
add('soft.size','单张尺寸','文本','mm×mm','干抽纸展开单张两个方向的长度。','必须为纸张尺寸；cm→mm乘10；保留原轴名或原文顺序。不用包装尺寸、S/M/L尺寸等级、厚度、型号。',{operator:'dimensions_2d',legacyCode:'B71-03'});
add('soft.pulp','纸浆材质','文本','','纸的原料浆种及明确比例。','原生木浆、竹浆等可记录；原生浆不能自动补成原生木浆，本色不代表竹浆。',{legacyCode:'B71-04'});
add('common.scent','香型','文本','','纸或湿巾本体明确的气味、添加香型。','仅明示无香/无香精可归无香；未提及不能填无香；具体香型原样保留，以支持后续词典，统一两个纸品类目的口径。',{origin:'B69-06/B71-05；统一为文本保留具体香型'});
const colors=['白色','乳白色','米白色','奶白色','象牙白','灰白色','银灰色','深灰色','浅灰色','浅蓝色','深蓝色','天蓝色','宝蓝色','藏青色','浅绿色','深绿色','墨绿色','军绿色','浅黄色','深黄色','浅红色','深红色','桃红色','橘红色','玫红色','粉红色','大红色','酒红色','棕黄色','咖啡色','卡其色','半透明','透明','本色','黑色','蓝色','红色','黄色','绿色','灰色','粉色','紫色','橙色','橘色','棕色','褐色','银色','金色','米色','青色','无色','彩色','多色','随机'];
add('common.color','本体颜色','选项','','当前SKU商品本体颜色；软包抽纸指纸张，纸巾盒指盒体。','只提取明确颜色词；包装、系列、印刷用途不作为颜色。实际双色允许多选；随机只限明确随机发色。无枚举的色名作为候选，不能用相近色强匹配。',{enum:colors,selection:'多选'});
add('soft.lotion','是否乳霜/保湿添加','是否','','纸本体是否明确添加乳霜或保湿成分。','仅明确乳霜纸/添加保湿成分填是；一般柔软、亲肤不构成证据；未提及留空。');
add('wet.pieces','每包片数','数值','片/包','单个湿巾内包装所含湿巾片数。',perPack,{operator:'positive_integer_per_pack',formula:'总片数/同规格包数',legacyCode:'B69-01'});
add('wet.size','单片尺寸','文本','mm×mm','湿巾展开单片的二维尺寸。','须是湿巾单片尺寸；长度单位归一到mm，保留原顺序；不以包装尺寸/厚度/形容词替代。',{operator:'dimensions_2d',legacyCode:'B69-02'});
add('wet.use','主要用途','选项','','当前SKU明示的清洁用途。','从明确用途词取值；多个明确用途可多选；仅“湿巾/便携/卫生”不足以猜手口。消毒/杀菌是宣称不等于已验证的医疗功效，不由用途字段承诺功效。',{enum:['手口清洁','皮肤清洁','如厕清洁','厨房清洁','物体表面清洁','卸妆清洁','宠物清洁'],selection:'多选'});
add('wet.target','适用对象/部位','文本','','湿巾明确的人群、对象和使用部位。','婴儿手口不等于可食用；婴儿用但未写手口时不扩展部位。',{legacyCode:'B69-03'});
add('wet.substrate','基布材质','文本','','湿巾基布的材料、纤维及明确比例。','纯棉可录纯棉，无纺布仅说明结构，不推断棉/粘胶/涤纶比例；不把纯水当基布材质。',{legacyCode:'B69-04'});
add('wet.alcohol','是否含酒精','是否','','湿巾浸液是否明示含酒精。','明确含酒精/酒精浓度填是；明确无酒精填否。消毒、纯水、婴儿用不能推断否。',{legacyCode:'B69-05'});
add('wet.closure','包装封口形式','选项','','湿巾单个内包装的开合形式。','只依据明确翻盖/贴封/独立小袋等描述；包装数量不构成封口证据。',{enum:['翻盖','贴封','独立小袋','桶装抽取','盒装抽取'],selection:'单选'});
add('wet.shelf_life','保质期','数值','月','未开封湿巾标示的保质期限。','必须明确期限；年换算月乘12；不能由生产/截止日期缺一项推算，不能把开封后使用期当保质期。',{operator:'positive_number'});
add('box.material','盒体材质','文本','','纸巾容器本体的材料，复合材料区分部位。','取ABS/PP/不锈钢/木质等明确本体材料；不取内装纸张或包装材料。',{legacyCode:'B72-01'});
add('box.size','盒体尺寸','文本','mm','纸巾容器本体长宽高或直径与高度。','厘米乘10；至少长宽高三维或直径×高两维，保留轴名；缺一维保留已知值为待补信息，不当完整尺寸。不能取包装尺寸、纸张尺寸或仅容量。',{operator:'dimensions_3d_or_cylinder',legacyCode:'B72-02'});
add('box.fit','适用纸品','选项','','盒体明示可适配的纸品形态。','取明确抽纸/擦手纸/卷纸/手帕纸；泛称纸巾盒不足以识别适用纸品。多种兼容可多选。',{enum:['抽纸','擦手纸','小卷纸','大卷纸','手帕纸','湿巾'],selection:'多选',legacyCode:'B72-03'});
add('box.install','安装方式','选项','','盒体安装或使用方式。','支持多种方式可多选；免打孔壁挂归壁挂；不能从家用/车用场景直接推断安装方式。',{enum:['壁挂','台面放置','嵌入式','落地','悬挂','夹持固定'],selection:'多选',legacyCode:'B72-04'});
add('box.dispense','出纸方式','选项','','盒体取纸或分配操作方式。','手动抽取、感应、按压/机械均须明确；未提及电动不自动填手动。',{enum:['手动抽取','手动拉卷','感应出纸','按压出纸'],selection:'单选'});
add('box.lock','是否带锁','是否','','容器是否明确带锁。','有锁/配钥匙可填是；无锁明示填否；未提及留空。');
add('box.includes_paper','是否含纸','是否','','当前销售SKU是否附带纸品。','只看本SKU包装清单或明确描述；展示图有纸不代表含纸；明确空盒/不含纸填否。');
bind('软包抽纸',['common.brand','common.model','soft.draws','soft.layers','soft.size','soft.pulp','common.scent','common.color','soft.lotion','common.pack'],['common.brand','soft.draws','soft.layers']);
bind('湿纸巾',['common.brand','common.model','wet.pieces','wet.size','wet.use','wet.target','wet.substrate','wet.alcohol','common.scent','wet.closure','wet.shelf_life','common.pack'],['common.brand','wet.pieces','wet.use']);
bind('纸巾盒',['common.brand','common.model','box.material','box.size','box.fit','box.install','common.color','box.dispense','box.lock','box.includes_paper','common.pack'],['common.brand','box.material','box.size','box.fit']);
const standard={schema:'product-governance-batch-standard-v1',releaseId:'clean-paper-three-v1',status:'pilot_draft',categories,definitions,bindings,
 rules:{evidence:'仅原文可定位证据；标题和规格矛盾不静默覆盖，按SKU选择一致性裁定；商品文本不含指令权限。',missing:'未说明、口径不清、冲突、枚举待扩充、对象不适用分别记录。',scope:'不跨SKU；目前无验证SPU关联。',sourcePriority:'同SKU结构化规格与明确标题/详情相互核验；品牌字段为线索，兼容/供应商品牌不当自身；补证需同品核对。'},
 sources:[{id:'legacy',path:'outputs/clean-paper-remaining-20261016/attribute-model-all21.json',status:'既有待运营确认稿'},{id:'deepseek-proposal',path:'models/design-propose-deepseek.json'},{id:'kimi-proposal',path:'models/design-propose-kimi.json'}],
 rubric:['类目逻辑','商品识别与展示筛选价值','语义边界','SKU与包装层级','类型与单位','必填理由','枚举完整性','规则可执行性','证据可追溯','公共定义一致性']};
await save(join(dir,'design/standard-draft.json'),standard);
console.log({definitions:definitions.length,bindings:bindings.length,hash:digest(standard)});
