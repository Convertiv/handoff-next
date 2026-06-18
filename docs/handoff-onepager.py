from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
from reportlab.lib.colors import HexColor, black, white

OUT = "docs/handoff-onepager.pdf"

# ── Colors ──────────────────────────────────────────────────────────────────
ink        = HexColor("#1a1a1a")
muted      = HexColor("#6b7280")
rule_color = HexColor("#e5e7eb")
label_color = HexColor("#9ca3af")

# ── Styles ───────────────────────────────────────────────────────────────────
def style(name, **kw):
    base = dict(fontName="Helvetica", fontSize=10, leading=16,
                textColor=ink, spaceAfter=0, spaceBefore=0)
    base.update(kw)
    return ParagraphStyle(name, **base)

S = {
    "eyebrow": style("eyebrow", fontSize=8, textColor=label_color,
                     fontName="Helvetica", leading=12, spaceAfter=4),
    "title":   style("title",   fontSize=22, fontName="Helvetica-Bold",
                     leading=28, spaceAfter=6),
    "subtitle":style("subtitle",fontSize=13, textColor=muted, leading=18, spaceAfter=0),
    "label":   style("label",   fontSize=8,  fontName="Helvetica-Bold",
                     textColor=label_color, leading=12, spaceAfter=6),
    "body":    style("body",    fontSize=10, leading=16, spaceAfter=10,
                     textColor=ink),
    "bold_term":style("bold_term", fontSize=10, fontName="Helvetica-Bold",
                      leading=16, spaceAfter=2, textColor=ink),
    "term_body":style("term_body", fontSize=10, leading=16, spaceAfter=10,
                      textColor=ink, leftIndent=0),
    "footer":  style("footer",  fontSize=8,  textColor=label_color,
                     leading=12, alignment=TA_CENTER),
}

def rule():
    return HRFlowable(width="100%", thickness=0.5, color=rule_color,
                      spaceAfter=16, spaceBefore=16)

def gap(n=8):
    return Spacer(1, n)

def label(text):
    return Paragraph(text.upper(), S["label"])

def body(text):
    return Paragraph(text, S["body"])

# ── Document ─────────────────────────────────────────────────────────────────
doc = SimpleDocTemplate(
    OUT,
    pagesize=letter,
    leftMargin=1*inch,
    rightMargin=1*inch,
    topMargin=0.85*inch,
    bottomMargin=0.85*inch,
    title="Design data shouldn't live in silos",
    author="Convertiv",
)

story = []

# Header
story += [
    Paragraph("HANDOFF &mdash; STRATEGIC DIRECTION", S["eyebrow"]),
    gap(4),
    Paragraph("Design data shouldn’t live in silos", S["title"]),
    Paragraph("The case for headless, MCP-first design systems built on open standards", S["subtitle"]),
    rule(),
]

# Section 1
story += [
    label("Where the problem starts"),
    gap(4),
    body("Every team we work with has the same fundamental friction: design decisions are locked inside Figma, content lives in a CMS, component docs drift in Notion or Confluence, and the codebase has its own version of all of it. None of these talk to each other. The result is inefficient, and more: nobody has a reliable, complete picture of the design system at any given moment."),
    rule(),
]

# Section 2
story += [
    label("The answer is a better data structure"),
    gap(4),
    body("The design industry has spent years inventing proprietary formats for storing design decisions. Every tool creates its own schema, every export is shaped slightly different. SaaS tools have a strong incentive to sell licenses, and every SaaS imagines it can capture the whole stack."),
    body("Open standards, LLMs, MCP, and headless architectures are changing that. We’re building Handoff around these patterns. By adopting robust open data standards that power MCP-driven tools, we can enable first-party ownership connected to the rest of the ecosystem. There are two standards we’ve worked to adopt:"),
    gap(4),
    Paragraph("<b>DTCG — Design Token Community Group</b> <font color='#9ca3af'>(adopted now)</font>", S["body"]),
    body("The stable, widely-adopted open standard for design tokens. Supported by Figma, Style Dictionary, Tokens Studio, and most major design tools. Defines how colors, spacing, typography, and other token values are stored and referenced. Our canonical format for all token data."),
    gap(4),
    Paragraph("<b>DSDS — Design System Document Spec</b> <font color='#9ca3af'>(experimenting)</font>", S["body"]),
    body("The most comprehensive open schema we’ve found for capturing a design system end-to-end. Like Handoff, it tries to describe the whole design system as code — going beyond tokens to codify components, foundations, docs, provenance, and relationships between them. Still being written, but already the most rigorous thinking in this space. We’re building toward it."),
    gap(4),
    body("The bet isn’t that DSDS becomes dominant. It’s that grounding ourselves in the most thorough available thinking about design system data puts us ahead of tools that are still inventing their own formats."),
    rule(),
]

# Section 3
story += [
    label("What headless and MCP-first actually means"),
    gap(4),
    body("A headless design system stores design decisions in an open format that any tool can consume. Change a token in one place and every downstream output updates: CSS variables, Tailwind config, iOS tokens, a downloadable file for any tool that speaks DTCG."),
    body("MCP-first means AI coding tools (Cursor, Claude, Copilot) treat the design system as a data source they can query directly. We can provide structured answers to real questions: which token to use for a destructive action, what a component expects as input, whether something is approved or still in draft. The design system becomes legible to the tools your team is already using."),
    body("And we can build powerful LLM-driven tools on top of this design structure — generating prototypes that are exactly on brand, generating landing pages that are up to date with the latest component structure."),
    rule(),
]

# Section 4
story += [
    label("Why early adoption is the play"),
    gap(4),
    body("Standards are most useful before they’re obvious. Every major design tool will eventually support DTCG. DSDS is earlier, which means there’s still room to shape how it gets used in practice, to build integrations before the space is crowded, and to tell a story about Handoff that isn’t available to tools that are only chasing the present."),
    body("Teams that adopt this model also stop doing the repetitive translation work between design and code. Handoff can become a clearinghouse and a pipeline to connect the tools teams already use, without locking those teams into a product."),
    body("We’re already building the foundation. Handoff’s token pipeline is being rewritten in DTCG, with the broader DSDS schema as a guiding shape for how we model the rest of the system. The infrastructure for a standards-compliant, MCP-queryable design system is taking shape now."),
    body("We can build better documentation on top of a fundamentally different relationship between design data and the tools that consume it."),
    rule(),
]

# Footer
story += [
    Paragraph("Handoff — June 2026 · convertiv.com", S["footer"]),
]

doc.build(story)
print(f"Written: {OUT}")
