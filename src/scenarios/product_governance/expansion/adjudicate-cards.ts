import {join} from 'node:path';
import {read,save} from '../runtime/storage.ts';
import {RUN} from './settings.ts';
const decisionReasons:Record<string,string[]>={
 'initial-deepseek':[
  '采纳。统一完整纸容器适配纸型，中心抽卷纸保留明确枚举，不改变配件为单独零件的边界。',
  '采纳完整尺寸与待补维度区分。缺维保留原始证据和缺项原因，不能把不完整尺寸当正式已填。',
  '采纳。盒体与附件材料按部位写，排除内装纸和运输箱材料。',
  '部分采纳。防盗不证明带锁；不采纳把普通锁扣/卡扣当锁，须明确钥匙、密码或电子锁证据。',
  '采纳。未列纸品不证明不含纸；否也需明示证据。',
  '采纳证据原则；机械出纸结构可由同SKU原图核验，感应/电动仍须明确证明。',
  '采纳。单包装范围、同规格、赠品和计算过程写入共用规则。',
  '采纳。纸张展开尺寸与包装尺寸、厚度、S/M/L等级分开。',
  '采纳。触感、颜色、纯水不证明浆种；比例未明不补造比例。',
  '采纳。系列名不直接推气味；明确具体香型按原词保留候选，不强归相近项。',
  '不新增重复用途。“如厕清洁”已有且可承接湿厕纸；保留商品原文即可。',
  '采纳。杀菌、婴儿、纯水不证明酒精状态，未提及留缺项。',
  '部分采纳。翻盖+贴封需双证据；仅“密封”不足以推密封撕口，不采纳该自动映射。',
  '采纳。原湿巾每包片数继续固定片口径，其他单位保留原文，不默认转换；本轮三新类采用成组单位。',
  '采纳。销售盒/包/箱计数不等于直接内包装形态。'
 ],
 'initial-kimi':[
  '采纳。21类统一为完整可重复用容器归纸巾盒、单独替换件归对应专用配件。',
  '采纳缺省处理，保留品牌业务必填；无证据是缺项，不以无品牌占位。',
  '采纳。旧字段仅保留追溯映射，本轮仅使用冻结标准属性ID。',
  '部分采纳。保留既有soft.draws/wet.pieces稳定ID与原单位；本轮手帕纸/洗脸巾/擦手纸用一组数量+计数单位+内包装单位，不重复必填。',
  '采纳统一枚举，不采纳“其余18类后做”的范围建议；本轮明确统一全部21类。',
  '采纳。本体色与随机发色说明分开，不以随机冒充固定颜色。',
  '采纳。common.pack以当前SKU明确赠品、加量、异规格或跨类组成证据触发条件必填。',
  '采纳证据缺失处理，wet.use保留核心必填，不按覆盖率降级。',
  '采纳。冲突不默选标题；OCR为候选，须原图或同SKU结构化证据核验。',
  '采纳。预浸湿巾与干式厨房纸、洗脸巾分开。',
  '部分采纳。明确抽取结构或原图可核验手动方式；未说明电动本身仍不足以推手动。',
  '不采纳推迟18类的建议。层数、尺寸、浆料、香型、包装等本轮统一共享定义与绑定。'
 ],
 'final-deepseek':[
  '部分采纳。补可执行分节适用条件，required=true表示适用时核心必填；未知保留缺项，不采纳把条件未知视为不缺项。',
  '同上，补无芯小卷纸分节条件；明确不分节才不适用。',
  '同上，补大卷纸分节条件；不删除有业务价值的节数属性。',
  '同上，中心抽长度与分节条件分开，不默认全部中心抽卷都分节。',
  '同上，大卷擦手纸保留长度与分节路径，明确条件才决定节数字段适用性。',
  '采纳条件表达。按重量路径与计数路径分开，至少一条完整，未采用的路径不强制净重；条件未知不全面豁免。',
  '采纳条件表达，生活用纸单品计量组至少一条完整路径，不以缺信息伪装不适用。',
  '现有规则已禁止0与默认值；保留必填，缺数量/单位/层级分别记待补，不因缺信息修改属性。',
  '采纳。明确抽取或平叠干巾不适用单卷长度；不分节卷式走长度路径，条件未知保留缺项。',
  '采纳风险，不采用含混建议。洗脸巾计数单位移除卷，卷作为内包装单位保留，卷数不替代成品量或卷长。',
  '采纳重申：先确认直接硬盒结构，再记录每盒抽数；外箱不算硬盒内包装。',
  '该限制在原paper.quantity规则和手帕纸绑定已存在；保留并加明示例“4层10片仍为10片”，不报告为新增事实错误。',
  '采纳明确10+6组成规则，需单包范围后才能求和，混规格不能平均。',
  '边界已明确预浸液与干湿两用干巾；保留先归属再字段的执行规则，不新增重复字段。',
  '采纳显式补充防盗不等于带锁；原有钥匙/密码/电子锁规则保持。'
 ]
};
const decisions:any[]=[];
for(const round of ['initial','final'])for(const model of ['deepseek','kimi']){
 const file=join(RUN,'normalized',`cards-${round}-${model}.json`);if(!await Bun.file(file).exists())continue;
 const r:any=await read(file),reasons=decisionReasons[round+'-'+model];
 for(const [i,x] of r.content.issues.entries()){
  const reason=reasons?.[i];if(!reason)continue;
  decisions.push({id:`${round}-${model}-${String(i+1).padStart(2,'0')}`,round,model,...x,action:reason.startsWith('不采纳')?'不采纳':reason.startsWith('部分')?'部分采纳':reason.startsWith('现有')||reason.startsWith('该限')||reason.startsWith('边界')?'保留已有规则并澄清':'采纳或落实',reason,adjudicator:'Codex'});
 }
}
const extraFile=join(RUN,'design/kimi-final-decisions.json');
if(await Bun.file(extraFile).exists()){const k:any=await read(extraFile);decisions.push(...k.decisions);}
const finalKimi:any=await Bun.file(join(RUN,'normalized/cards-final-kimi.json')).exists()?await read(join(RUN,'normalized/cards-final-kimi.json')):null;
const expected=Object.values(decisionReasons).reduce((n,rs)=>n+rs.length,0)+(finalKimi?.content?.issues?.length??0);
await save(join(RUN,'design/adjudication.json'),{status:finalKimi&&decisions.length===expected?'root-approved':'pending-final-kimi',decisions,scope:'全部21类，保留原3类稳定ID并将旧稿全部映射到本轮定义；没有执行线上迁移。',additionalDecisions:[{subject:'品牌空枚举',action:'字典引用不生成空enum，生产字典未对齐项保留候选。'},{subject:'同值不同计数词',action:'按明确证据原单位记录，不默认换算，也不把措辞差异本身当实质冲突。'},{subject:'生活用纸具体承接类型',action:'登记无V2更专类的干式抽取厕用卫生纸；不泛化为任意错挂/混装兜底。'},{subject:'范围建议纠正',action:'初审两模型自行缩到旧3类；root明确拒绝，终审重新提供全部21类完整卡。'}]});
console.log({decisions:decisions.length,expected,status:finalKimi&&decisions.length===expected?'root-approved':'pending-final-kimi'});
