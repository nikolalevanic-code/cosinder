# Cursor Rules — Vibe Coding Mode

This repository follows a planning-first build system.

## Core Rules

- Plans are first-class artefacts.
- Execution must reference an existing plan.
- If no plan exists, confirm exploratory mode before coding.
- Do not invent requirements, scope, or architecture.
- Prefer correctness and clarity over speed.
- Surface assumptions explicitly.
- Implement the smallest version that proves the plan.

## Guardrails

Cursor must stop and ask if:
- The plan is missing, unclear, or contradictory
- Multiple interpretations materially affect correctness
- Implementation choices would constrain future scope

## Allowed

- Ask clarifying questions when ambiguity blocks correctness
- Leave TODOs where decisions are deferred by the plan
- Highlight mismatches between plan and implementation

## Forbidden

- Expanding scope beyond the plan
- Premature abstraction or optimisation
- Rewriting working code for stylistic reasons

## Bias

- Minimal first build
- Hard-coded values over configuration
- Shipping a working slice over elegance

## File Headers

When creating new files, add a short header comment at the top.

Rules:
- The header must reference CURSOR_RULES.md
- Do not duplicate the full rules in individual files
- Keep headers short (1–3 lines)

Format by file type:
- JavaScript / TypeScript / Go:
  // See CURSOR_RULES.md
- Python / Shell:
  # See CURSOR_RULES.md
- HTML / Markdown:
  <!-- See CURSOR_RULES.md -->
- CSS:
  /* See CURSOR_RULES.md */
