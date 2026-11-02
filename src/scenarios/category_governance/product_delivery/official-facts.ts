import type { ReviewedFact } from "./facts.ts";
const url="https://www.dji.com/inspire-3/specs";
const official=(value:ReviewedFact["value"],summary:string,note?:string):ReviewedFact=>({value,source:`制造商官方规格：${url}`,quote:summary,note:`2026-09-14核对官方同型号资料。${note??""}`});
// The VOP seller sheet mislabels an Inspire 3 as a toy drone, with "none"
// photo formats and a different certification model. Use the named manufacturer's
// specification; never convert aircraft model T740 into a claimed approval ID.
export const officialFacts:Record<number,Record<string,ReviewedFact>>={
  677:{
    型号:official("DJI Inspire 3（T740）","官方飞行器型号T740；产品页为DJI Inspire 3。"),
    最长飞行时间:official(28,"最长飞行约28分钟，起落架放下；升起时约26分钟。","在海平面、无风等官方测试条件下测得，不代表实地续航保证。"),
    无人机类型:official("全画幅航拍电影机","产品为搭载全画幅相机的Inspire 3。"),
    视频分辨率:official("最高8192×4320（8K）","官方视频最大分辨率8192×4320。","具体帧率/编码能力与录制格式及授权有关。"),
    主摄CMOS尺寸:official("35mm全画幅","官方传感器为35mm全画幅CMOS。"),
    避障功能:official(true,"提供前后、侧向、上下方向障碍感知。","受光照、表面纹理等限制；起落架升降过程中暂停障碍感知。"),
    图片格式:official("JPG；DNG","官方支持JPG、DNG照片格式。"),
    实时图传质量:official("FPV最高1080p/60fps；云台最高1080p/60fps或4K/30fps","官方列明FPV及云台画面的不同图传规格。"),
    最大信号有效距离:official("SRRC单控：FPV约8km；云台1080p约7km、4K约3km","官方按控制模式、画质及地区标准分别列出图传距离。","无阻挡、无干扰测试值，非飞行航程。"),
    最大抗风速:official("起降12m/s；飞行中14m/s","官方分别公布起降与飞行中的抗风速。","海平面及官方载荷条件下的参考指标。"),
    数据传输:official("O3 Pro图传","官方图传系统为O3 Pro。"),
    电池容量:official(98.8,"TB51单块电池标称能量98.8Wh。","此值指单块电池能量，不是整套电池总能量。"),
  },
};
