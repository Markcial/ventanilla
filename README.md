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
| `ping` | — | health check used by the test suite |

## What is real and what is not

Being precise about this matters more than looking finished.

**Real**
- The filing calendar. Quarterly deadlines, the shift to the next working day
  when a deadline lands on a weekend, and the earlier cut-off for filing by
  direct debit are all computed, not hardcoded per year.
- All data is genuinely local. There is no server to send it to.

**Simplified, and labelled as such in the UI**
- Public holidays are not applied — only weekends. Real filing software needs the
  full national and regional holiday calendar.
- The profile is sample data until you edit it.

**Not attempted**
- No connection to AEAT, Cl@ve, DNIe, DEHú or Seguridad Social. Those are closed
  to private developers, or require being a registered *colaborador social*.
  Claiming otherwise would be a lie a judge could check.

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

## License

MIT
