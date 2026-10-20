import type {ModelConfig} from './models.ts';
// API key is read at request time from .env. Config and call ledgers contain no secret.
// Subscription usage is not represented as $0 cost; usage tokens are recorded, cash cost unknown.
export const OPENCODE_MODELS:ModelConfig[]=[
 {id:'glm',adapter:'opencode_go',provider:'opencode-go',model:'glm-5.3-flash',family:'glm',reasoningEffort:'low',timeoutMs:180000,maxOutputTokens:14000,maxInputChars:180000,maxCalls:70,maxUsd:null},
 {id:'qwen',adapter:'opencode_go',provider:'opencode-go',model:'qwen3.8-flash',family:'qwen',timeoutMs:180000,maxOutputTokens:14000,maxInputChars:180000,maxCalls:70,maxUsd:null},
];
