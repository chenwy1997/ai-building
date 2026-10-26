import { Blocked, hash } from "./core.ts";
import type { RecordedRequest } from "./request-journal.ts";
import type { StageClient } from "./runner.ts";

// Reusable for any stage. Reconstruct all history with the normal loop, verify
// each paid request, then either stop for an offline preview or delegate the
// next request to the ordinary cached/accounted transport. No new loop budget.
export function verifiedReplayClient(options: { client: StageClient | null;
  mode: "offline" | "network"; transportId: string; transcript: RecordedRequest[] }) {
  const { client, mode, transportId, transcript } = options;
  let cursor = 0;
  const replay: StageClient = { mode, transportId, budget: { init: async () => {} },
    request: async (body, identity) => {
      const key = hash({ body, identity, transportId, mode }), prior = transcript[cursor];
      if (prior) {
        if (prior.request.key !== key)
          throw new Blocked("resume_transcript_drift", "reconstructed request differs from paid transcript at round " + (cursor + 1));
        cursor++;
        if (client) return client.request(body, identity);
        return { key, response: prior.response, cached: true };
      }
      if (!client) throw new Blocked("resume_ready", "verified historical transcript; next request requires explicit --execute");
      return client.request(body, identity);
    } };
  return { client: replay, consumed: () => cursor };
}
