import type { DB } from "../db/open.js";
import type { ProposalRow } from "../policy/approvals.js";
import type { Tools, Review } from "./tools.js";

/** Opus reviews a proposal's exact terms; the text is stored beside the proposal, outside its hash. */
export async function attachReview(db: DB, tools: Tools, p: ProposalRow, context: string): Promise<Review & { source: string }> {
  const r = await tools.review(p.kind, p.terms_json, context);
  const text = `[${r.source === "claude" ? r.model : "no model"}] ${r.value.recommendation.toUpperCase()}: ${r.value.summary} ${r.value.why}${r.value.risks.length ? ` Risks: ${r.value.risks.join("; ")}` : ""}`;
  db.prepare("UPDATE proposals SET explanation = ? WHERE proposal_id = ?").run(text, p.proposal_id);
  return { ...r.value, source: r.source };
}
