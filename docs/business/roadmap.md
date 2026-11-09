# After the hackathon: one honest card

**A plan, not a promise.** No dates: "next" means the first things we would do, "later" means after those. Nothing
here is built unless it says so. The longer product roadmap (more agents, more rails) is in
[docs/roadmap.md](../roadmap.md). **We have not validated demand with customers yet** ([model.md](model.md)).

Back to the [business case index](README.md).

| When | What | Where it stands today |
|---|---|---|
| Next | **Test the demand hypothesis** with finance teams before building more | Not started |
| Next | **Production Airwallex:** a production account, a scoped key with an IP allowlist, the API version pinned | Sandbox only; scoped key not recorded, no IP allowlist, API version not pinned ([controls.md](../controls.md#not-in-place-summary)) |
| Next | **A real second human approver** for four eyes, with their own passkey | Four eyes is built; in the demo the second approver is a labelled test passkey, and four eyes is off on the business account ([cfo-policy.md](../cfo-policy.md#four-eyes-two-people-above-a-threshold)) |
| Next | **ERP and accounting integration:** post each approved payment, with its approval hash, to the customer's books | A GL export exists ([airwallex.md](../airwallex.md)); posting to T:0 is built but failed on its keys, so nothing is posted ([run log](../runs/2026-11-05-t0-live.md)) |
| Later | **Visa Intelligent Commerce in production** | Run in test on 7 November: Visa Intelligent Commerce via Airwallex's Airi, sandbox and test card, 5 of 5 checks ([docs/runs/2026-11-07-vic-1.md](../runs/2026-11-07-vic-1.md)). Production needs access from Visa and Airwallex ([plans/visa-tap-vic.md](../plans/visa-tap-vic.md)) |
| Later | **A SOC 2 path:** an outside audit of the controls, then the gaps it finds | Controls are written up in SOC 2 style, with what is not in place listed; no audit yet ([controls.md](../controls.md), [compliance.md](../compliance.md#what-a-real-launch-would-add)) |
