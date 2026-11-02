import type {ScenarioModule} from '../types.ts';
import {main} from './entry.ts';
export const categoryAttributesGovernanceScenario:ScenarioModule={name:'category_attributes_governance',displayName:'类目属性治理',description:'固定类目上下文、语义证据检索、多轮属性增量及独立验收',migrations:[],commands:{run:async({args})=>main(args)}};
