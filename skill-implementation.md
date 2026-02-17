# Skill Implementation Plan

## Goals
- Add a skills feature compatible with common coding agents (Amp/Claude/Cursor-style `SKILL.md`).
- Discover skills from multiple locations with clear precedence (option 2).
- Wire minimal on-demand skill detection that can be replaced by more advanced methods later.
- Keep lazy loading of skill content to avoid token and memory overhead.

## Scope
- Implement a `SkillRegistry` for discovery, metadata parsing, and lazy loading.
- Inject `{{skills}}` into decomposer prompts.
- Add `action_type: 'skill'` execution path in the DAG executor.
- Provide minimal trigger detection with a clean interface for swapping in other detectors.

## Discovery Algorithm (Option 2: Multi-Location with Precedence)
Order of discovery (first match wins on name conflicts):
1. Workspace: `.agents/skills/`
2. Workspace root: `skills/`
3. Workspace root: `SKILL.md` (single-skill fallback)
4. Global: `~/.config/agents/skills/`

Rules:
- For multi-skill directories, each skill must live in its own directory with `SKILL.md`.
- `name` in frontmatter must match the directory name.
- Invalid or missing frontmatter should surface a warning but not crash discovery.

## Minimal Trigger Detection (On-Demand)
Add a minimal detector that can be replaced later:
- `SkillDetector` interface with `detect(goalText, availableSkills)`.
- Initial implementation: keyword match against `name` and `description` (case-insensitive).
- Optional explicit triggers in text: `use skill <name>` or `--skill <name>`.

Why this is minimal:
- No LLM call.
- No ranking model.
- Simple to replace with a more advanced detector (embedding/LLM-based) by swapping the detector implementation.

## Architecture Changes

### 1) Skill Registry
Create `src/core/skills/registry.ts`:
- `discover()` scans locations and builds metadata index.
- `getAll()` returns metadata list.
- `getByName(name)` returns metadata entry.
- `loadContent(name)` loads full `SKILL.md` on demand.

Data model:
- `SkillMeta`: `{ name, description, filePath, source }`

### 2) Skill Detector
Create `src/core/skills/detector.ts`:
- `SkillDetector` interface and `MinimalSkillDetector` implementation.
- Single public method: `detect(goalText, skills)` returns list of names.

Drop-in replacement note:
- Any new detector must implement the same interface, and can be wired in the same place in `dags.ts`.

### 3) Prompt Injection
Update `src/core/execution/dags.ts`:
- Instantiate `SkillRegistry` and `SkillDetector`.
- Detect relevant skills from goal text.
- Inject skills into decomposer prompt using `{{skills}}` placeholder.

Update `seed/agents.json`:
- Add `{{skills}}` to decomposer system prompt.

### 4) Execution Branch
Update `src/core/execution/dagExecutor.ts`:
- Add `action_type: 'skill'` branch.
- Load SKILL.md content lazily.
- Execute via `LlmExecuteTool` using the skill content as the system context.

## Implementation Steps
1. Add `SkillRegistry` and `SkillDetector` modules.
2. Wire discovery and detection into DAG creation before prompt assembly.
3. Add `{{skills}}` placeholder in decomposer prompt template.
4. Add `action_type: 'skill'` branch in DAG executor.
5. Add a small log/trace to show which skills were selected.
6. Add documentation section to `README.md` or `docs/` explaining skill locations and format.

## Validation
- Run a sample goal with a known skill (`cataloging-apis`) and confirm:
  - `SkillRegistry` discovers it.
  - Detector picks it when goal text mentions “API documentation”.
  - Decomposer receives `{{skills}}` filled.
  - `action_type: 'skill'` executes with the SKILL.md context.

## Future Enhancements (Drop-In)
- Replace `MinimalSkillDetector` with:
  - Embedding-based semantic matching.
  - Lightweight LLM classifier.
  - User-provided skill override flags.
- Add caching for loaded skill content.
- Allow per-agent skill scopes or filters.
