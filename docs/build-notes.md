# How this was built

The long version: what we were aiming at, what the tax agency said back, and the
four things that cost us an afternoon each.

---

## Inspiration

Spain has no open identity API. Cl@ve is closed to private developers. Acting with
someone's digital certificate means holding their private key, which no third party
should ever do. The only way to act before the Spanish tax agency is **one person,
with their certificate, in a browser**.

We kept treating that as the obstacle. It is the whole argument.

Spanish freelancers already pay someone to solve this. Every gestoría in the country
breaks in the same place: **the last mile**. They will chase your invoices, compute
your return, and then email you a PDF — and the act that actually counts is still
yours to perform, somewhere else, on a different site, usually on the last afternoon
of the filing window. The work gets done. The handoff is where it falls apart.

A chatbot fails the same way for free. It answers your question and gives you a link.
Every bit of the actual pain lives downstream of that link: the forty-field form, the
figure you have to fetch from somewhere else, the deadline nobody told you about. The
agent's job ends exactly where the work begins.

Ventanilla removes the handoff. Preparing and signing happen on one surface, seconds
apart, done by the person whose name is on the invoice.

A conventional MCP server would need your credentials and a backend holding your tax
ID and your taxable base. WebMCP does not. The tools run in the tab you are already
signed into, every record stays in IndexedDB, and each tool changes the page you are
looking at — so the confirmation is the document, not a summary you have to trust.

## What it does

Ventanilla is invoicing and tax paperwork for Spanish freelancers, built so a person
and their agent do it together.

Say *"invoice Astillero Ribera 800 euros plus VAT"* and the agent issues it: serial
number, Verifactu record, SHA-256 fingerprint chained to the previous invoice, QR
code. Say *"what do I have to file next?"* and it works out your deadlines from your
registration date, VAT regime and income tax method. Say *"work out my VAT return"*
and it computes modelo 303 into the numbered boxes of the official form.

Then it stops, and you press Send. Your browser asks which certificate to use.
Nothing can answer that prompt for you — not the page, not the agent.

That is the last mile, and it is deliberately the only step left. Everything before it
is done; everything about it is yours. No PDF in an inbox, no second website, no
waiting on someone else's Tuesday.

**A record built this way has been accepted by the AEAT.** Envío Correcto, Registro
Correcto, receipt `A-2DL83NSPLJHYMY`, against their preproduction service, which
accepts real certificates and has no fiscal effect.

Every tool has to earn its place against three conditions: it needs state a chatbot
cannot have, it ends in an artifact or an irreversible act, and the person confirms
against the real object. Anything failing one is a chatbot with extra steps, and was
cut.

## How we built it

Astro, no backend at all. Every record lives in IndexedDB, which is what makes it
possible for an agent to touch real fiscal data in the first place.

The Verifactu implementation follows the AEAT specification rather than our memory of
it. Both official documents carry worked examples with expected results, and all of
them are tests: the three fingerprint vectors and the QR example reproduce exactly.
Anyone can check our numbers against theirs.

`npm run test:schema` fetches `SuministroLR.xsd` from the tax agency at run time and
validates generated envelopes with `xmllint` — against what they publish today, not a
copy that quietly goes stale.

The test harness came from a discovery. **Chrome 151 ships an undocumented CDP
`WebMCP` domain** — `enable`, `invokeTool({frameId, toolName, input})`, and
`toolsAdded` / `toolInvoked` / `toolResponded` events, reachable with
`--enable-features=WebMCPTesting,DevToolsWebMCPSupport`. So every tool gets a real
integration test: register, discover, invoke, assert on the output an agent would
actually receive. No extension, no agent in the loop.

## Challenges we ran into

**A third-party inspector reported zero tools and answered by reading the screen.**
It was right to. We were rendering the deadlines on page load, so the answer was
already in the DOM and an agent could scrape it and look like it had used the tool —
the exact failure WebMCP exists to end. The panel starts empty now and says so, and a
test asserts it. If something appears there, a tool ran.

**Every value correct, element order wrong.** `DetalleType` requires
`CalificacionOperacion` or `OperacionExenta` *before* `TipoImpositivo`. A sequence in
the wrong order is invalid however right the data is. The schema test caught it on its
first run, before it ever reached the agency.

**`fetch()` cannot reach the tax agency, and this is measured.** With a valid
certificate, `OPTIONS` returns 403 "Request forbidden by administrative rules" and no
response carries a single `Access-Control-*` header. A form post is different: it is a
navigation, CORS does not apply, the service ignores `Content-Type` and `SOAPAction`
entirely, and it tolerates the trailing `=` that `enctype="text/plain"` appends. So a
form whose field name is the entire envelope submits successfully — and the browser
asks who is signing.

**A lowercase tax ID passes the schema and fails the agency.** `NIFType` constrains
only the length to nine characters. `43730021y` validates perfectly and then does not
match the certificate. We normalise on the way in now, because a fingerprint covers
what was stored: fixing it afterwards invalidates the record.

## What we learned

**Being safe to demonstrate with and being acceptable to file are the same property
with opposite signs.** Our sample tax IDs come from the range in the AEAT's own
published examples, so they identify nobody — and are therefore rejected with error
1239, "El NIF no está identificado en el censo". Preproduction validates recipients
against the real census. A demo you can repeat safely is, necessarily, a demo the
agency will not accept.

**Where you put a refusal matters as much as having one.** We made submission refuse
to classify a zero-VAT invoice, then watched a real agent create one anyway and
interrogate the person about exemption codes days later. The question belongs at the
moment the invoice is created, when they still have the operation in mind.

**The schema is not the authority.** It said yes twice to things the agency said no
to.

**The last mile is not a gap to close — it is the product.** Everyone building in this
space tries to shorten the distance to the signature. The distance is not the problem.
The handoff is. Delete the handoff and a step that felt like an obstruction becomes the
one moment the person actually wants to be present for.

## What's next

The identity gap has a closing date. Under eIDAS 2, member states must offer an
official digital wallet by 24 November 2026. When it lands, the same tools prepare and
the wallet signs — and the arrangement this project argues for stops needing a
certificate export at all.
