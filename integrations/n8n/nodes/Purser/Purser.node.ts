// The Purser node for n8n: read invoices, propose a payment, read a proposal's status. Its description is plain data
// (./description.ts); n8n makes the requests from it. No approve operation: only the CFO's passkey approves.
import type { INodeType, INodeTypeDescription } from "n8n-workflow";
import { purserDescription } from "./description";

export class Purser implements INodeType {
  description = purserDescription as unknown as INodeTypeDescription;
}
