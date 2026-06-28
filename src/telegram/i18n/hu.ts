import type { en } from "./en.js";

/** Hungarian translations of the bot-side operational strings. */
export const hu: Record<keyof typeof en, string> = {
  // --- bot.ts: turn lifecycle + errors ---
  bot_working: "💭 Dolgozom rajta…",
  bot_stopped: "⏹ Leállítva.",
  bot_stopped_plain: "Leállítva.",
  bot_done: "Kész.",
  bot_busy: "⏳ Még az előző kérésen dolgozom. Küldd a /stop parancsot a megszakításhoz.",
  bot_rate_limited: "🐢 Lassíts — még utolérem magam. Próbáld újra kb. {seconds} mp múlva.",
  bot_action_failed: "⚠️ A művelet nem sikerült.\n\n{detail}",
  bot_dl_file_failed: "⚠️ Nem sikerült letölteni a fájlt: {error}",
  bot_dl_image_failed: "⚠️ Nem sikerült letölteni a képet: {error}",
  bot_voice_no_speech: "🎤 Nem hallottam ki beszédet abból a hangüzenetből.",
  bot_voice_failed: "⚠️ A hangátirat nem sikerült: {error}",
  bot_scheduled: "⏰ <b>Ütemezett feladat</b>\n<i>{prompt}</i>",
  bot_task_stopped: "⏹ Feladat leállítva — {title}{by}",
  bot_task_failed: "⚠️ Feladat sikertelen — {title}{by}{error}",
  bot_inbox_suggestion:
    "💡 Új beérkező javaslat tőle: <b>{agent}</b>{category}\n{title}\n\n{count} vár — nézd meg az /inbox paranccsal",
  bot_loop_aborted:
    "🔁 <b>Hurok észlelve</b> — leállítottam egy autonóm futást, miután <b>{name}</b> {count}× megismételte ugyanazt a hívást, hogy ne pazaroljon tokeneket.",
  bot_report: "✅ Jelentés",
  bot_report_with: "✅ Jelentés · {parts}",
  bot_tool_calls_one: "{n} eszközhívás",
  bot_tool_calls_many: "{n} eszközhívás",
  bot_usage_reached: "📊 {label} használati limit elérve. Visszaáll: {countdown}.",
  bot_usage_exhausted_label: "📊 Használati limit kimerült. {label} visszaáll: {countdown}.",
  bot_usage_exhausted: "📊 Használati limit kimerült. Várd meg a visszaállást, majd próbáld újra.",
  bot_err_rate_limited: "⏳ Az API korlátozott. Várj egy pillanatot, és próbáld újra.",
  bot_err_overloaded: "🌀 Az API jelenleg túlterhelt. Próbáld újra hamarosan.",
  bot_err_auth:
    "🔑 A hitelesítés sikertelen. Ellenőrizd az ANTHROPIC_API_KEY értékét, vagy futtasd újra a `claude` CLI bejelentkezést, majd indítsd újra.",

  // --- permissions.ts: approvals ---
  appr_header_one: "🔐 <b>Engedély szükséges</b>",
  appr_header_many: "🔐 <b>{n} engedély szükséges</b>",
  appr_approve: "✅ Engedélyez",
  appr_deny: "❌ Elutasít",
  appr_always_tool: "♾️ Mindig engedélyezd: {tool}",
  appr_always_cmd: "♾️ Mindig engedélyezd a `{cmd}` parancsokat",
  appr_allow_all: "✅✅ Mind engedélyez",
  appr_deny_all: "❌❌ Mind elutasít",
  appr_expired: "Ez a kérés lejárt.",
  appr_toast_approved: "✅ Engedélyezve",
  appr_toast_always_tool: "♾️ Mindig engedélyezve: {tool}",
  appr_toast_always_cmd: "♾️ Az a parancs mindig engedélyezve",
  appr_toast_denied: "❌ Elutasítva",
  appr_toast_none: "Nincs függőben lévő kérés.",
  appr_toast_approved_all: "✅✅ Mind engedélyezve ({n})",
  appr_toast_denied_all: "❌❌ Mind elutasítva ({n})",

  // --- gitFlow.ts ---
  git_commit_all: "✅ Összes commitolása",
  git_discard_all: "↩️ Összes elvetése",
  git_confirm_discard_btn: "⚠️ Igen, mindent elvetek",
  git_cancel: "Mégse",
  git_not_repo: "📂 A <code>{cwd}</code> nem git tároló.",
  git_clean: "✨ A munkamásolat tiszta — nincs mit átnézni.",
  git_changes_one: "<b>Változások itt:</b> <code>{dir}</code> ({n} fájl)\n<pre>{status}</pre>",
  git_changes_many: "<b>Változások itt:</b> <code>{dir}</code> ({n} fájl)\n<pre>{status}</pre>",
  git_review_caption: "Nézd át a változásokat, majd válassz egy műveletet:",
  git_confirm_discard_toast: "Biztos elveted?",
  git_cancelled: "Megszakítva",
  git_auto_commit_msg: "Frissítés Telegramon át — {iso}",
  git_committed: "✅ Commitolva.\n<pre>{out}</pre>",
  git_commit_failed: "⚠️ A commit nem sikerült.\n<pre>{out}</pre>",
  git_committed_toast: "Commitolva",
  git_commit_failed_toast: "A commit nem sikerült",
  git_discarded:
    "↩️ A követett fájlok változásai elvetve. (A nem követett fájlok megmaradtak.)",
  git_discard_failed: "⚠️ Az elvetés nem sikerült.\n<pre>{out}</pre>",
  git_discarded_toast: "Elvetve",
  git_discard_failed_toast: "Az elvetés nem sikerült",

  // --- projects.ts ---
  proj_header: "<b>📁 Projektek</b>\nKoppints egy könyvtárra a munkakönyvtár váltásához.",
  proj_remove_btn: "🗑",
  proj_save_another: "➕ Másik mentése (előbb /cd)",
  proj_save_current: "➕ Jelenlegi könyvtár mentése",
  proj_empty:
    'Még nincs mentett projekt. Lépj be egy könyvtárba a <code>/cd</code> paranccsal, majd koppints a "Jelenlegi könyvtár mentése" gombra.',
  proj_current: "Jelenlegi: <code>{cwd}</code>",
  proj_already_saved: "Már mentve",
  proj_saved: "Mentve: {name}",
  proj_removed: "Eltávolítva: {name}",
  proj_gone: "Eltűnt (az a könyvtár már nem létezik)",
  proj_now_in: "Most itt: {name}",

  // --- voice.ts ---
  voice_hint_vosk:
    "🎤 A hang nincs beállítva. Állítsd be a VOSK_MODEL_PATH-t egy letöltött Vosk modellhez (és telepítsd az ffmpeg-et).",
  voice_hint_openai:
    "🎤 A hang nincs beállítva. Adj OPENAI_API_KEY-t a .env fájlhoz az átirat engedélyezéséhez.",
  voice_not_configured: "A hangátirat nincs konfigurálva (állítsd be az OPENAI_API_KEY-t).",
  voice_http_error: "Az átirat nem sikerült (HTTP {status}): {detail}",

  // --- resumePrompt.ts ---
  resume_btn: "↩️ Előző kontextus folytatása",
  resume_fresh_btn: "🆕 Új kezdés",
  resume_offer:
    "♻️ Újraindultam, mióta utoljára beszéltünk. Folytassuk az előző beszélgetést, vagy kezdjük újra?\n\n<i>Automatikus folytatás {seconds} mp múlva…</i>",
  resume_expired: "Ez a kérés lejárt.",
  resume_starting_fresh: "Új kezdés",
  resume_resuming: "Előző kontextus folytatása",
  resume_started_fresh: "🆕 <i>Új beszélgetés indítva.</i>",
  resume_resumed: "↩️ <i>Előző beszélgetés folytatva.</i>",

  // --- loopPrompt.ts ---
  loop_prompt:
    "🔁 <b>Hurok észlelve</b>\nA(z) <b>{tool}</b> <b>{count}×</b> futtatta ugyanazt a hívást ebben a körben:\n\n<pre><code>{summary}</code></pre>\nKihagyod, engedélyezed még egyszer, vagy hagyod folytatódni?",
  loop_skip_btn: "⏭️ Kihagy",
  loop_approve_once_btn: "1️⃣ Egyszer engedélyez",
  loop_continue_btn: "▶️ Folytatás",
  loop_timed_out: "⏳ <i>Időtúllépés — folytatom.</i>",
  loop_expired: "Ez a kérés lejárt.",
  loop_skipped_toast: "⏭️ Kihagyva",
  loop_allowed_once_toast: "1️⃣ Egyszer engedélyezve",
  loop_continuing_toast: "▶️ Folytatom",

  // --- askQuestion.ts ---
  ask_no_answer: "(nincs válasz)",
  ask_timed_out_default: 'Időtúllépés — alapértelmezett: "{fallback}".',
  ask_other_btn: "✏️ Egyéb (írj választ)",
  ask_done_btn: "✔️ Kész",
  ask_expired: "Ez a kérdés lejárt.",
  ask_type_answer: "✏️ Írd be a válaszod normál üzenetként.",
  ask_type_answer_toast: "Írd be a választ",
  ask_unknown_option: "Ismeretlen lehetőség.",
  ask_selected: "Kiválasztva: {label}",
  ask_unselected: "Visszavonva: {label}",
  ask_pick_one: "Előbb válassz legalább egy lehetőséget.",
  ask_unknown_action: "Ismeretlen művelet.",
  ask_answer_given: "🗣️ <b>{header}:</b> {answer}",
  ask_pick_instruction: "<i>Válassz egyet vagy többet, majd koppints a Kész gombra.</i>",

  // --- inboxFlow.ts ---
  inbox_header: "<b>📥 Javaslatok beérkezője</b>",
  inbox_park_btn: "📋 Eltesz",
  inbox_delegate_btn: "🚀 Delegál",
  inbox_dismiss_btn: "✕ Elvet",
  inbox_details_btn: "🔎 Részletek",
  inbox_empty: "A beérkező üres. Semmi nem vár áttekintésre.",
  inbox_instructions: "Az Eltesz backlog kártyát hoz létre; a Delegál most elvégezteti; az Elvet archiválja.",
  inbox_gone: "Ez a javaslat eltűnt.",
  inbox_details:
    "🔎 <b>{title}</b>\n<i>tőle: {agent}</i>{category}\n\n{detail}",
  inbox_details_category: "\n<i>Kategória: {category}</i>",
  inbox_generic_run: "egy általános futás",
  inbox_details_posted: "Részletek elküldve",
  inbox_parked: "Elrakva → backlog kártya",
  inbox_already_decided: "Már eldöntve",
  inbox_delegated:
    "🚀 Delegálva: <b>{title}</b> ide: <b>{who}</b>. A kártya folyamatban; jelentkezem, ha kész.",
  inbox_delegated_toast: "Delegálva ide: {lead}",
  inbox_delegated_toast_plain: "Delegálva",
  inbox_delegate_failed: "Nem sikerült elindítani (már fut?)",
  inbox_dismissed: "Elvetve",

  // --- taskFlow.ts ---
  task_retry_btn: "🔁 Újra",
  task_unknown_action: "Ismeretlen művelet",
  task_gone: "A feladat már nem létezik",
  task_already_running: "Már fut",
  task_could_not_retry: "Nem sikerült újrapróbálni",
  task_retrying: "Újrapróbálom…",
  task_retrying_attempt: "Újrapróbálom ({n}. próbálkozás)…",
};
