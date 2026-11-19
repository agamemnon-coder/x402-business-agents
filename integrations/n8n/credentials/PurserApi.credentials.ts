// The Purser API credential for n8n: the cloud's URL and an API key, sent as Authorization: Bearer. The key is kept in
// n8n's credential store, never in a workflow. Test request: GET /v1/me.
import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from "n8n-workflow";
import { purserCredential } from "../nodes/Purser/description";

export class PurserApi implements ICredentialType {
  name = purserCredential.name;
  displayName = purserCredential.displayName;
  documentationUrl = purserCredential.documentationUrl;
  properties = purserCredential.properties as unknown as INodeProperties[];
  authenticate = purserCredential.authenticate as unknown as IAuthenticateGeneric;
  test = purserCredential.test as unknown as ICredentialTestRequest;
}
