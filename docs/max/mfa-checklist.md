# MFA-checklist voor Max (zelf doen, vóór de repo openbaar wordt)

Zet op elk account een **passkey** aan, en daarnaast een tweede factor als reserve: een authenticator-app of een
hardwaresleutel. Gebruik **geen sms**. Plak nooit codes, herstelcodes of sleutels in de chat, ook niet naar Claude.
Bewaar de herstelcodes op papier of in je wachtwoordmanager.

| # | Account | Wat je aanzet | Waar |
|---|---|---|---|
| 1 | **GitHub** (agamemnon-coder) | Passkey, plus 2FA met een authenticator-app. Bekijk ook de actieve sessies en de "Personal access tokens"; verwijder wat je niet kent. | Settings → Password and authentication |
| 2 | **Cloudflare** (de Worker van de relay) | Passkey of security key, plus 2FA. Bekijk de API-tokens: hou alleen het token voor deploy, met zo weinig rechten als kan. | My Profile → Authentication |
| 3 | **Airwallex** (sandbox en straks live) | 2FA aan. Bekijk de API-keys: alleen de sandbox-key die Purser gebruikt. | Account settings → Security |
| 4 | **Anthropic Console** | Log in met Google (met passkey, zie 5), of met e-mail plus 2FA. Bekijk de API-keys; zet een maandlimiet op de key van Purser. | console.anthropic.com → Settings |
| 5 | **Google** (het account achter de logins) | Passkey, plus 2-Step Verification met een authenticator-app. Controleer je herstel-e-mail en herstelnummer. | myaccount.google.com → Security |
| 6 | **Slack** (hackathon-workspace) | 2FA met een authenticator-app. | Profile → Account → Two-factor authentication |
| 7 | **Metal-console** (testnet) | 2FA of passkey, als de console dat aanbiedt; anders inloggen met Google (zie 5). | console-testnet.metalntwx.com |
| 8 | **Je telefoon** (de passkey voor Purser) | Een sterke toegangscode, Face ID aan, en "Zoek mijn iPhone" aan. | Instellingen → Face ID en toegangscode |

## Daarna, vóór de repo openbaar wordt

- Laat Claude de stappen voor een openbare repo draaien (`docs/requirements-matrix.md`, rij "Public repository"):
  gitleaks over de hele geschiedenis, en pas daarna zet jij de repo op openbaar.
- Roteer de sleutels die ooit buiten je eigen apparaten zijn geweest. Dat doe jij zelf, Claude niet. Daarna zet je de
  nieuwe waarden in de omgeving van de runner.

**Klaar?** Zeg in de chat alleen: "MFA staat aan op 1 t/m 8". Geen codes en geen schermafbeeldingen van
instellingen met sleutels erop.
