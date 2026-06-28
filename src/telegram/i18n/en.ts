/**
 * Bot-side i18n catalog (English, the source of truth).
 *
 * These are the bot's OWN user-facing operational strings (status lines,
 * approval buttons, error fallbacks, flow toasts) — NOT model output and NOT
 * log lines. Keys are flat with an area prefix (e.g. `appr_`, `git_`). Use
 * `{name}` placeholders for interpolation, filled by `t(key, lang, vars)`.
 *
 * Add every new key here first; `TranslationKey` is derived from this object so
 * other locales (and call sites) are checked against it at compile time.
 */
export const en = {
  // --- bot.ts: turn lifecycle + errors ---
  bot_working: "💭 Working on it…",
  bot_stopped: "⏹ Stopped.",
  bot_stopped_plain: "Stopped.",
  bot_done: "Done.",
  bot_busy: "⏳ Still working on the previous request. Send /stop to cancel.",
  bot_rate_limited: "🐢 Slow down — I'm still catching up. Try again in ~{seconds}s.",
  bot_action_failed: "⚠️ That action failed.\n\n{detail}",
  bot_dl_file_failed: "⚠️ Could not download file: {error}",
  bot_dl_image_failed: "⚠️ Could not download image: {error}",
  bot_voice_no_speech: "🎤 Couldn't make out any speech in that note.",
  bot_voice_failed: "⚠️ Voice transcription failed: {error}",
  bot_scheduled: "⏰ <b>Scheduled task</b>\n<i>{prompt}</i>",
  bot_task_stopped: "⏹ Task stopped — {title}{by}",
  bot_task_failed: "⚠️ Task failed — {title}{by}{error}",
  bot_inbox_suggestion:
    "💡 New inbox suggestion from <b>{agent}</b>{category}\n{title}\n\n{count} pending — review with /inbox",
  bot_loop_aborted:
    "🔁 <b>Loop detected</b> — stopped an autonomous run after <b>{name}</b> repeated the same call {count}× to avoid burning tokens.",
  bot_report: "✅ Report",
  bot_report_with: "✅ Report · {parts}",
  bot_tool_calls_one: "{n} tool call",
  bot_tool_calls_many: "{n} tool calls",
  bot_usage_reached: "📊 {label} usage limit reached. Resets in {countdown}.",
  bot_usage_exhausted_label: "📊 Usage limit exhausted. {label} resets in {countdown}.",
  bot_usage_exhausted: "📊 Usage limit exhausted. Wait for the limit to reset, then retry.",
  bot_err_rate_limited: "⏳ Rate limited by the API. Give it a moment and try again.",
  bot_err_overloaded: "🌀 The API is overloaded right now. Try again shortly.",
  bot_err_auth:
    "🔑 Authentication failed. Check ANTHROPIC_API_KEY or re-run the `claude` CLI login, then restart.",

  // --- permissions.ts: approvals ---
  appr_header_one: "🔐 <b>Permission needed</b>",
  appr_header_many: "🔐 <b>{n} permissions needed</b>",
  appr_approve: "✅ Approve",
  appr_deny: "❌ Deny",
  appr_always_tool: "♾️ Always allow {tool}",
  appr_always_cmd: "♾️ Always allow `{cmd}` commands",
  appr_allow_all: "✅✅ Allow all",
  appr_deny_all: "❌❌ Deny all",
  appr_expired: "This request has expired.",
  appr_toast_approved: "✅ Approved",
  appr_toast_always_tool: "♾️ Always allowing {tool}",
  appr_toast_always_cmd: "♾️ Always allowing that command",
  appr_toast_denied: "❌ Denied",
  appr_toast_none: "No pending requests.",
  appr_toast_approved_all: "✅✅ Approved all {n}",
  appr_toast_denied_all: "❌❌ Denied all {n}",

  // --- gitFlow.ts ---
  git_commit_all: "✅ Commit all",
  git_discard_all: "↩️ Discard all",
  git_confirm_discard_btn: "⚠️ Yes, discard everything",
  git_cancel: "Cancel",
  git_not_repo: "📂 <code>{cwd}</code> is not a git repository.",
  git_clean: "✨ Working tree clean — nothing to review.",
  git_changes_one: "<b>Changes in</b> <code>{dir}</code> ({n} file)\n<pre>{status}</pre>",
  git_changes_many: "<b>Changes in</b> <code>{dir}</code> ({n} files)\n<pre>{status}</pre>",
  git_review_caption: "Review the changes, then choose an action:",
  git_confirm_discard_toast: "Confirm discard?",
  git_cancelled: "Cancelled",
  git_auto_commit_msg: "Update via Telegram — {iso}",
  git_committed: "✅ Committed.\n<pre>{out}</pre>",
  git_commit_failed: "⚠️ Commit failed.\n<pre>{out}</pre>",
  git_committed_toast: "Committed",
  git_commit_failed_toast: "Commit failed",
  git_discarded:
    "↩️ Discarded changes to tracked files. (Untracked files were left in place.)",
  git_discard_failed: "⚠️ Discard failed.\n<pre>{out}</pre>",
  git_discarded_toast: "Discarded",
  git_discard_failed_toast: "Discard failed",

  // --- projects.ts ---
  proj_header: "<b>📁 Projects</b>\nTap a directory to switch the working dir.",
  proj_remove_btn: "🗑",
  proj_save_another: "➕ Save another (use /cd first)",
  proj_save_current: "➕ Save current dir",
  proj_empty:
    'No saved projects yet. <code>/cd</code> into a directory, then tap "Save current dir".',
  proj_current: "Current: <code>{cwd}</code>",
  proj_already_saved: "Already saved",
  proj_saved: "Saved {name}",
  proj_removed: "Removed {name}",
  proj_gone: "Gone (that directory no longer exists)",
  proj_now_in: "Now in {name}",

  // --- voice.ts ---
  voice_hint_vosk:
    "🎤 Voice isn't set up. Set VOSK_MODEL_PATH to a downloaded Vosk model (and install ffmpeg).",
  voice_hint_openai:
    "🎤 Voice isn't set up. Add OPENAI_API_KEY to .env to enable transcription.",
  voice_not_configured: "Voice transcription is not configured (set OPENAI_API_KEY).",
  voice_http_error: "Transcription failed (HTTP {status}): {detail}",

  // --- resumePrompt.ts ---
  resume_btn: "↩️ Resume previous context",
  resume_fresh_btn: "🆕 Fresh start",
  resume_offer:
    "♻️ I restarted since we last spoke. Resume our previous conversation, or start fresh?\n\n<i>Auto-resuming in {seconds}s…</i>",
  resume_expired: "This prompt has expired.",
  resume_starting_fresh: "Starting fresh",
  resume_resuming: "Resuming previous context",
  resume_started_fresh: "🆕 <i>Started a fresh conversation.</i>",
  resume_resumed: "↩️ <i>Resumed the previous conversation.</i>",

  // --- loopPrompt.ts ---
  loop_prompt:
    "🔁 <b>Loop detected</b>\n<b>{tool}</b> has run the same call <b>{count}×</b> this turn:\n\n<pre><code>{summary}</code></pre>\nSkip it, allow it once more, or let it keep going?",
  loop_skip_btn: "⏭️ Skip",
  loop_approve_once_btn: "1️⃣ Approve once",
  loop_continue_btn: "▶️ Continue",
  loop_timed_out: "⏳ <i>Timed out — continuing.</i>",
  loop_expired: "This prompt has expired.",
  loop_skipped_toast: "⏭️ Skipped",
  loop_allowed_once_toast: "1️⃣ Allowed once",
  loop_continuing_toast: "▶️ Continuing",

  // --- askQuestion.ts (only user-facing strings; model-facing tool-result
  //     strings stay English inline since the model, not the user, reads them) ---
  ask_no_answer: "(no answer)",
  ask_timed_out_default: 'Timed out — defaulted to "{fallback}".',
  ask_other_btn: "✏️ Other (type a reply)",
  ask_done_btn: "✔️ Done",
  ask_expired: "This question has expired.",
  ask_type_answer: "✏️ Type your answer as a normal message.",
  ask_type_answer_toast: "Type your answer",
  ask_unknown_option: "Unknown option.",
  ask_selected: "Selected {label}",
  ask_unselected: "Unselected {label}",
  ask_pick_one: "Pick at least one option first.",
  ask_unknown_action: "Unknown action.",
  ask_answer_given: "🗣️ <b>{header}:</b> {answer}",
  ask_pick_instruction: "<i>Pick one or more, then tap Done.</i>",

  // --- inboxFlow.ts ---
  inbox_header: "<b>📥 Suggestion inbox</b>",
  inbox_park_btn: "📋 Park",
  inbox_delegate_btn: "🚀 Delegate",
  inbox_dismiss_btn: "✕ Dismiss",
  inbox_details_btn: "🔎 Details",
  inbox_empty: "Inbox clear. Nothing waiting for review.",
  inbox_instructions: "Park files a backlog card; delegate gets it done now; dismiss archives it.",
  inbox_gone: "That suggestion is gone.",
  inbox_details:
    "🔎 <b>{title}</b>\n<i>from {agent}</i>{category}\n\n{detail}",
  inbox_details_category: "\n<i>Category: {category}</i>",
  inbox_generic_run: "a generic run",
  inbox_details_posted: "Details posted",
  inbox_parked: "Parked → backlog card",
  inbox_already_decided: "Already decided",
  inbox_delegated:
    "🚀 Delegated <b>{title}</b> to <b>{who}</b>. The card is in progress; I'll report back when it's done.",
  inbox_delegated_toast: "Delegated to {lead}",
  inbox_delegated_toast_plain: "Delegated",
  inbox_delegate_failed: "Couldn't start (already running?)",
  inbox_dismissed: "Dismissed",

  // --- taskFlow.ts ---
  task_retry_btn: "🔁 Retry",
  task_unknown_action: "Unknown action",
  task_gone: "Task no longer exists",
  task_already_running: "Already running",
  task_could_not_retry: "Could not retry",
  task_retrying: "Retrying…",
  task_retrying_attempt: "Retrying (attempt {n})…",
} as const;

export type TranslationKey = keyof typeof en;
