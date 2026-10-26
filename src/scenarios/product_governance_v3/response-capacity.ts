// Provider capabilities verified 2026-10-26 against the official model/Responses
// docs. This is an output ceiling (reasoning + visible output), not 1M context.
export const MAX_PROVIDER_OUTPUT_TOKENS = 393216;
export const DEFAULT_BATCH_OUTPUT_TOKENS = 65536;
export const BATCH_PRICING_ID = "deepseek-flash-20261023-peak-byte-bound-cny9-v1";
export function outputTokens(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_PROVIDER_OUTPUT_TOKENS)
    throw Error("max-output-tokens must be 1.." + MAX_PROVIDER_OUTPUT_TOKENS);
  return value;
}
export function outputTimeoutMs(tokens: number) {
  return outputTokens(tokens) > 24000 ? 600000 : 240000;
}
// Preserve the original conservative byte bound and add peak-price allowance
// for extra output only. Never lower historical reservations or replenish money.
export function outputReservation(oldTokens: number, oldReserve: number, tokens: number, pricingId: string) {
  outputTokens(tokens);
  if (tokens <= oldTokens) return oldReserve;
  if (pricingId !== BATCH_PRICING_ID) throw Error("unregistered output pricing policy");
  return Math.ceil((oldReserve + (tokens - oldTokens) * 1.2 * 9 / 1_000_000) * 10) / 10;
}
