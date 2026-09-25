/**
 * The Claude Code settings that are not rules and not the plugin: git write
 * protection, the todo tools flag, and the task-tracking rule.
 *
 * The logic lives in the plugin (`skills/init/scripts/settings.mjs`) so that
 * `/agent-os:init` inside Claude Code and `agent-os init` in a terminal write
 * exactly the same thing. This module is the CLI's door to it.
 */
export {
  TODO_ENV, TASK_RULE, GIT_DENY, userDir, paths,
  mergeSettings, addTaskRule, applyScope, describe,
} from "../plugins/agent-os/skills/init/scripts/settings.mjs";
