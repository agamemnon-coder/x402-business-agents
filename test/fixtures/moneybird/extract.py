# Writes openapi-subset.json: the request-body schemas of the Moneybird endpoints Purser's connector calls, taken
# verbatim from Moneybird's official OpenAPI file (all $refs inlined, descriptions and examples dropped), so the test
# fake (test/fakes/moneybird.ts) validates every request against Moneybird's own schema.
#   curl -sSo openapi.yml https://raw.githubusercontent.com/moneybird/openapi/refs/heads/main/openapi.yml
#   python3 -I test/fixtures/moneybird/extract.py openapi.yml > test/fixtures/moneybird/openapi-subset.json
import json, sys, yaml

spec = yaml.safe_load(open(sys.argv[1]))
WANT = [
    ("post", "/{administration_id}/contacts{format}"),
    ("post", "/{administration_id}/documents/purchase_invoices{format}"),
    ("post", "/{administration_id}/documents/purchase_invoices/{id}/payments{format}"),
    ("post", "/{administration_id}/documents/purchase_invoices/{id}/attachments{format}"),
    ("post", "/{administration_id}/documents/general_journal_documents{format}"),
]
DROP = {"description", "example", "examples", "summary", "title"}

def resolve(o, depth=0, field_names=False):
    """Inlines $refs and drops annotations. Under "properties" every key is a field name (a field may be called
    "description" or "title"), so nothing is dropped there."""
    if depth > 40:
        raise SystemExit("schema too deep")
    if isinstance(o, dict):
        if "$ref" in o and not field_names:
            node = spec
            for part in o["$ref"].split("/")[1:]:
                node = node[part]
            merged = {**resolve(node, depth + 1), **{k: v for k, v in o.items() if k != "$ref" and k not in DROP}}
            return resolve(merged, depth + 1)
        if field_names:
            return {k: resolve(v, depth + 1) for k, v in o.items()}
        return {k: resolve(v, depth + 1, k == "properties") for k, v in o.items() if k not in DROP}
    if isinstance(o, list):
        return [resolve(x, depth + 1) for x in o]
    return o

out = {"_source": {"url": "https://raw.githubusercontent.com/moneybird/openapi/refs/heads/main/openapi.yml", "version": spec["info"]["version"]}, "requests": {}}
for method, path in WANT:
    op = spec["paths"][path][method]
    content = op["requestBody"]["content"]
    ctype, body = next(iter(content.items()))
    out["requests"][f"{method.upper()} {path}"] = {"contentType": ctype, "scopes": op.get("security", [{}])[0].get("bearerAuth", []), "schema": resolve(body["schema"])}
json.dump(out, sys.stdout, indent=1, sort_keys=True)
print()
