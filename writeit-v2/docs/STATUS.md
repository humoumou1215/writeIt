# WriteIt v2 Status

Current phase: P0  
Current task: P0-06

## Completed
- [x] Initial v2 implementation spec prepared
- [x] Root and legacy agent instructions separated
- [x] P0-01 Repository Inventory
- [x] P0-02 Agent Context Split
- [x] P0-03 Pi Workflow
- [x] P0-04 Legacy Feature Map
- [x] P0-05 Safe Cleanup

## Active
- [ ] P0-06 Initial ADRs

## Blocked
None

## Recent decisions
- CM6 Architecture Spike = GO
- `writeit-v2/` is the v2 development mainline.
- `editor-app/` remains in place as legacy reference.
- Root Agent instructions are v2-focused; legacy Crepe, ego-lite, debug hooks and editor rules live under `editor-app/AGENTS.md`.
- `.pi/prompts/v2-task.md` and `.pi/prompts/v2-status.md` define one-task execution and status-maintenance workflows.
- `LEGACY_FEATURE_MAP.md` records legacy locations, v2 owners and one of the five permitted migration strategies for each mapped capability.

## Known risks
- Initial ADRs and the v2 scaffold have not yet been created.
- Root `README.md` was manually deleted by the user; P0-05 did not restore it. A new v1/v2 landing README remains planned for a later task, so the Phase 0 landing-document exit criterion remains open.
- `.pi/` and `.workbuddy/` debug resources still target the legacy application; they are intentionally retained and are not v2 diagnostics.
- User-created `fromChatgptWeb.md` is intentionally retained temporarily as reference material and is not a runtime dependency.
- Legacy `npm run test:unit` still has three failures in `tests/unit/diff/zz-seq-research.test.ts` (Mermaid sequence parsing and jsdom `getBBox`); P0-05 did not change that suite.

## Next
P0-07
