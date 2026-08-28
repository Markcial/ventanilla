# Ventanilla

Spanish freelance paperwork, prepared by your agent and decided by you.

Built for the [WebMCP Challenge](https://webmcp.devpost.com/).

## Why this is a WebMCP project and not an MCP server

Spain has no open identity APIs. Cl@ve is closed to private developers, and acting
with someone's digital certificate means holding their private key — which no
third party should ever do. The only way to act is *one person, with their
certificate, in a browser*.

That is not an obstacle WebMCP works around. It is the reason the agent has to
live inside the browser.

A conventional MCP server would need the user's credentials and a backend holding
their tax ID and their taxable base. Ventanilla has no backend at all. Tools run
in the already-authenticated tab, every record stays in IndexedDB, and each tool
changes the page the person is looking at — so the confirmation is the document
itself, not a summary they have to take on trust.

## What every tool has to earn

A capability only becomes a tool if all three hold:

1. It needs **state a chatbot does not have** — when you registered, your VAT
   regime, your previous invoices.
2. It ends in an **artifact or an irreversible action**.
3. The person **confirms against the real object**.

Anything failing one of those is a chatbot with extra steps, and was cut.

## Two modes

Whoever opens this has never registered as a Spanish freelancer, has no invoices
and no certificate. So there are two modes, and demo is the one you land in.

|  | Demo | Real |
|---|---|---|
| Profile | sample freelancer, pre-filled | yours, you type it in |
| Invoices | six sample invoices across Q3 2026 | yours |
| Calculations | the same code as real mode | the same code as demo mode |
| Signing | simulated | AutoFirma, your own certificate |
| Submitted to AEAT | never | never |

Neither mode files anything. Filing on someone else's behalf requires registered
*colaborador social* status, which this is not — so the honest ceiling is a
prepared, signed document, and both modes say so.

Demo and real data are separated in storage rather than filtered at the call
site, so a missed filter cannot mix sample invoices into real totals. Real mode
with an unfinished profile refuses to answer rather than borrowing demo values,
because confident wrong deadlines are worse than no deadlines.

### Switching modes is not a tool

An agent that could move someone from demo to real could get them to sign
something real while they believed they were trying a demo. The switch is a
button, reachable only by a person, and a test asserts no tool exposes it.

Every tool result carries its mode, so an agent cannot report sample data as
real even by accident.

## Tools

| Tool | What it needs to know about you | What you get |
|---|---|---|
| `list_obligations` | registration date, VAT regime, income tax method | every form still due, with deadlines, rendered on the page |
| `register_invoice` | the fingerprint of your last invoice, your tax ID, your series | a numbered invoice with its Verifactu record, chained fingerprint and QR |
| `prepare_vat_return` | every invoice of the quarter, at its own rate | modelo 303 as numbered boxes, ready to transcribe |
| `export_submission` | the invoice's stored fingerprint and generation time | the SOAP request the AEAT expects, as a file you send yourself |
| `ping` | — | health check used by the test suite |

## What is real and what is not

Being precise about this matters more than looking finished.

**Real**
- The Verifactu records. Fingerprints and chaining follow the AEAT specification,
  and the worked examples from both official documents — the three hash vectors
  and the QR example — are used verbatim as tests. Anyone can check the numbers.
- The filing calendar. Quarterly deadlines, the shift to the next working day
  when a deadline lands on a weekend, and the earlier cut-off for filing by
  direct debit are all computed, not hardcoded per year.
- All data is genuinely local. There is no server to send it to.

**Simplified, and labelled as such in the UI**
- Public holidays are not applied — only weekends. Real filing software needs the
  full national and regional holiday calendar.
- The profile is sample data until you edit it.

**Pointed somewhere safe on purpose**
- The QR carries the AEAT *external test* endpoint. Aiming it at production would
  tell whoever scans it that the invoice is registered with the tax agency.

**Not attempted**
- No connection to AEAT, Cl@ve, DNIe, DEHú or Seguridad Social. Those are closed
  to private developers, or require being a registered *colaborador social*.
  Claiming otherwise would be a lie a judge could check.

## Demonstrating without inventing anything real

Repeating a demo means issuing the same invoices over and over. That is only safe
if nothing about them can be mistaken for a record of something that happened.

- **Only the test environment is ever named.** Records sent to the production
  service join a real declared invoicing chain under a real tax identity. The
  production URL is absent from the source, not merely unused, and a test asserts
  nothing this app renders mentions that host.
- **Sample tax IDs come from the AEAT's own test census**, the `8989000x` block
  their published examples use — `89890001K` appears in the official QR document.
  Check digits are computed with the real algorithm, so they are well formed and
  identify nobody. A test asserts every tax ID on screen is in that block.
- **Company names are invented.** An earlier version billed an invented amount to
  "Ayuntamiento de Cadaqués" under a P-prefixed tax ID, the real format for a
  Spanish municipality. Sample data must not put a real body's tax identity on an
  invoice that documents nothing.

The preproduction environment exists so developers can send test records with a
real certificate and no fiscal consequences. Using it that way is what it is for.

## Verified against the tax agency, not just against the schema

A record produced by this app has been accepted by the AEAT preproduction
service:

```
Envío            Correcto
CSV              A-2DL83NSPLJHYMY
Registro         Correcto
```

An agent created the invoice from a sentence, the page chained and fingerprinted
it, and the person sent it under their own certificate. Preproduction accepts
real certificates and has no fiscal effect, which is what it is published for.

Two things that took getting there, both worth knowing before anyone tries:

- **A lowercase tax ID passes the schema and fails the agency.** `NIFType`
  constrains only the length to nine characters, so a lowercase check letter
  validates perfectly and then does not match the certificate signing the
  submission. Tax IDs are normalised on the way in now, before anything is
  hashed — after would be too late, since the fingerprint covers what was stored.
- **Recipient tax IDs are checked against the real census, in preproduction
  too.** The invented ones in the sample data come back as error 1239, "El NIF no
  está identificado en el censo de la AEAT". Being safe to demonstrate with and
  being acceptable to file are the same property with opposite signs.

## Why it prepares but never sends

Not a policy. A browser cannot reach the tax agency, and this is checkable in
half a minute:

```
$ curl -s -i -X OPTIONS https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP \
    -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: POST'
HTTP/2 302
location: https://sede.agenciatributaria.gob.es/Sede/errores/erro4033.html
```

No `Access-Control-Allow-*` headers at all, and the endpoint additionally
requires mutual TLS with a client certificate that `fetch()` has no way to
present. Either one alone would be enough.

Which is the argument this project makes, handed to us by the platform: the tax
agency is reachable only by a person holding a certificate. So the agent takes
the work as far as it goes, and the person performs the act that has
consequences.

`export_submission` builds the envelope and gives it to you with the exact curl
command to send it under your own certificate. There is also a local command for
it, which you run deliberately with your own certificate:

```bash
npm run submit:pre -- --cert cert.pem --key key.pem --file record.xml
```

That does not walk back the boundary. The browser still cannot send, nothing in
it runs in a page, the preproduction endpoint is fixed, and it refuses to send an
envelope that names production at all.

## Running it

```bash
npm install
npm run dev            # http://localhost:4321
```

To let an agent see the tools, open it in the ChatGPT desktop browser, or in
Chrome 149+ with the WebMCP trial enabled.

## Testing

Unit tests cover the date arithmetic, where mistakes are invisible to the eye:

```bash
npm test
```

Integration tests drive a real headless Chrome, discover the tools the way an
agent would, invoke them, and assert on the output an agent would receive:

```bash
npm run build && npm run test:webmcp
```

And the submissions are validated against the AEAT's own published schemas —
fetched from the tax agency at run time rather than vendored, so the check runs
against what they publish today:

```bash
npm run test:schema
```

That one earned its place immediately: it caught an envelope in which every
value was correct and the element order was not. `DetalleType` requires
`CalificacionOperacion` or `OperacionExenta` before `TipoImpositivo`, and a
sequence in the wrong order is invalid however right the data is.

That second suite is possible because Chrome 151 ships an undocumented CDP
`WebMCP` domain — `enable`, `invokeTool({frameId, toolName, input})`, and
`toolsAdded` / `toolInvoked` / `toolResponded` events — reachable with
`--enable-features=WebMCPTesting,DevToolsWebMCPSupport`. No extension and no
agent are needed in the loop, so every tool has a real regression test.

The one thing it cannot check is whether an agent *chooses* the right tool from a
vague sentence. That still needs a person and a real agent, and it is what the
tool descriptions are tuned against.

## Where this goes

The identity gap has a closing date. Under eIDAS 2 (Regulation (EU) 2024/1183),
member states must offer an official digital wallet by 24 November 2026. When
that lands, the same tools can prepare and the wallet can sign.

## Deploying it

The build takes a base path, because a project site on GitHub Pages is served from a
subdirectory:

```bash
BASE_PATH=/ventanilla/ npm run build
npm run test:pages
```

That second command is not ceremony. With a wrong base path the HTML still loads and
its module does not, so WebMCP never registers and the page looks merely broken rather
than broken in a way anyone would think to diagnose — and that only shows up once it is
live. It serves the build from the subdirectory, drives it with a real browser, and
checks the tools registered and nothing points outside the base.

Pushing to `main` deploys via GitHub Actions.

## The long version

[`docs/build-notes.md`](docs/build-notes.md) — what we were aiming at, what the tax
agency said back, and the four things that cost us an afternoon each.

## License

MIT
