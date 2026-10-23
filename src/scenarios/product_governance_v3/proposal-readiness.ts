// Program validity and useful proposal coverage are separate. In particular, an
// explained empty proposal is valid JSON but is not a completed attribute plan.
type ProposalJob = { status: string; artifact: { result: unknown } | null };
export function proposalReadiness(job: ProposalJob) {
  if (job.status !== "program_pass_pending_human" || !job.artifact) return "blocked" as const;
  return (job.artifact.result as { attributes: unknown[] }).attributes.length
    ? "proposal_pending_human" as const : "no_admitted_attributes" as const;
}
export function proposalCounts(jobs: ProposalJob[]) {
  return {
    proposalsPendingHuman: jobs.filter((j) => proposalReadiness(j) === "proposal_pending_human").length,
    noAdmittedAttributes: jobs.filter((j) => proposalReadiness(j) === "no_admitted_attributes").length,
  };
}
