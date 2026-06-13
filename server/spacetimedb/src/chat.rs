// ── Chat System ──
// Player chat and admin command routing.

use std::time::Duration;

use spacetimedb::{reducer, ReducerContext, Table};

use crate::admin::{insert_admin_help, is_admin, process_admin_command};
use crate::helpers::{find_chat_spam_issue, normalize_chat_text, timestamp_micros};
use crate::tables::*;

const CHAT_COOLDOWN_MS: u64 = 1_200;
const CHAT_BURST_WINDOW_MS: u64 = 10_000;
const CHAT_BURST_LIMIT: u8 = 5;
const CHAT_DUPLICATE_WINDOW_MS: u64 = 30_000;
const CHAT_BURST_MUTE_SECS: u64 = 15;

#[reducer]
pub fn send_chat(ctx: &ReducerContext, text: String) -> Result<(), String> {
    let text = normalize_chat_text(&text);
    if text.is_empty() || text.len() > 200 {
        return Err("Message must be 1-200 characters".to_string());
    }

    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    if text == "/" || text.eq_ignore_ascii_case("/help") {
        if is_admin(ctx, sender) {
            insert_admin_help(ctx);
            return Ok(());
        }
        // Non-admins fall through to the "starts with '/'" check below,
        // which returns "Unknown command".
    }

    if text.starts_with('/') {
        if !is_admin(ctx, sender) {
            return Err("Unknown command".to_string());
        }
        return process_admin_command(ctx, sender, &text);
    }

    if let Some(issue) = find_chat_spam_issue(&text) {
        return Err(issue.to_string());
    }

    let now_ms = timestamp_micros(ctx.timestamp) / 1_000;
    let throttle = ctx.db.chat_throttle().identity().find(sender);
    let had_throttle = throttle.is_some();

    if let Some(existing) = &throttle {
        let muted_until_ms = timestamp_micros(existing.muted_until) / 1_000;
        if muted_until_ms > now_ms {
            let remaining_ms = muted_until_ms - now_ms;
            return Err(format!(
                "Chat is temporarily locked for {:.1}s.",
                remaining_ms as f64 / 1_000.0
            ));
        }

        let last_message_ms = timestamp_micros(existing.last_message_at) / 1_000;
        let since_last_ms = now_ms.saturating_sub(last_message_ms);
        if since_last_ms < CHAT_COOLDOWN_MS {
            let remaining_ms = CHAT_COOLDOWN_MS - since_last_ms;
            return Err(format!(
                "You're sending messages too fast. Wait {:.1}s.",
                remaining_ms as f64 / 1_000.0
            ));
        }

        if existing.last_message_text == text
            && now_ms.saturating_sub(last_message_ms) < CHAT_DUPLICATE_WINDOW_MS
        {
            return Err("Don't repeat the same message.".to_string());
        }
    }

    let (window_started_at, messages_in_window, muted_until) = match throttle {
        Some(existing) => {
            let window_started_ms = timestamp_micros(existing.window_started_at) / 1_000;
            let window_is_active = now_ms.saturating_sub(window_started_ms) < CHAT_BURST_WINDOW_MS;
            let next_count = if window_is_active {
                existing.messages_in_window.saturating_add(1)
            } else {
                1
            };
            let next_window_started_at = if window_is_active {
                existing.window_started_at
            } else {
                ctx.timestamp
            };
            let next_muted_until = if next_count >= CHAT_BURST_LIMIT {
                ctx.timestamp + Duration::from_secs(CHAT_BURST_MUTE_SECS)
            } else {
                ctx.timestamp
            };

            (next_window_started_at, next_count, next_muted_until)
        }
        None => (ctx.timestamp, 1, ctx.timestamp),
    };

    ctx.db.chat_message().insert(ChatMessage {
        id: 0,
        sender,
        sender_name: player.username,
        text: text.clone(),
        sent_at: ctx.timestamp,
    });

    let next_state = ChatThrottle {
        identity: sender,
        last_message_at: ctx.timestamp,
        last_message_text: text,
        window_started_at,
        messages_in_window,
        muted_until,
    };

    if had_throttle {
        ctx.db.chat_throttle().identity().update(next_state);
    } else {
        ctx.db.chat_throttle().insert(next_state);
    }

    Ok(())
}
