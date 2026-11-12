# Writes sales-invoices.json: what Moneybird's official OpenAPI file documents for GET sales_invoices (the list of a
# company's sales invoices), for the read that the collections agent uses (src/erp/moneybird.ts openSalesInvoices):
# the path, its scope, the state values, the types of the fields Purser reads, and the documented example answers with
# only those fields kept. The test fake serves those examples.
#   curl -sSo openapi.yml https://raw.githubusercontent.com/moneybird/openapi/refs/heads/main/openapi.yml
#   python3 -I test/fixtures/moneybird/extract-sales.py openapi.yml > test/fixtures/moneybird/sales-invoices.json
import json, sys, yaml

spec = yaml.safe_load(open(sys.argv[1]))
PATH = "/{administration_id}/sales_invoices{format}"
READ = ["id", "contact_id", "contact", "invoice_id", "reference", "state", "invoice_date", "due_date", "currency", "total_price_incl_tax", "total_unpaid", "payment_url", "url"]
CONTACT = ["id", "company_name", "firstname", "lastname"]
op = spec["paths"][PATH]["get"]
schema = spec["components"]["schemas"]["sales_invoice_response"]["properties"]
contact = spec["components"]["schemas"]["simple_contact_response"]["properties"]
def keep(row):
    out = {k: row.get(k) for k in READ if k in row}
    if isinstance(out.get("contact"), dict):
        out["contact"] = {k: out["contact"].get(k) for k in CONTACT if k in out["contact"]}
    return out
examples = op["responses"]["200"]["content"]["application/json"]["examples"]
out = {
    "_source": {"url": "https://raw.githubusercontent.com/moneybird/openapi/refs/heads/main/openapi.yml", "version": spec["info"]["version"]},
    "endpoint": "GET " + PATH,
    "scopes": op.get("security", [{}])[0].get("bearerAuth", []),
    "states": schema["state"]["enum"],
    "fields": {k: schema[k].get("type", "object") for k in READ if k in schema},
    "contact_fields": {k: contact[k].get("type", "object") for k in CONTACT if k in contact},
    "examples": {name: [keep(r) for r in ex["value"]] for name, ex in sorted(examples.items()) if isinstance(ex.get("value"), list)},
}
json.dump(out, sys.stdout, indent=1, sort_keys=True)
print()
