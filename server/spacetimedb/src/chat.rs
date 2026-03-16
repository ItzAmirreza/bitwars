// ── Chat System ──
// Player chat and admin command routing.

use spacetimedb::{reducer, ReducerContext, Table};

use crate::admin::{insert_admin_help, is_admin, process_admin_command};
use crate::tables::*;

#[reducer]
pub fn send_chat(ctx: &ReducerContext, text: String) -> Result<(), String> {
    let text = text.trim().to_string();
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
        if is_admin(&player.username) {
            insert_admin_help(ctx);
            return Ok(());
        }
        // Non-admins fall through to the "starts with '/'" check below,
        // which returns "Unknown command".
    }

    if text.starts_with('/') {
        if !is_admin(&player.username) {
            return Err("Unknown command".to_string());
        }
        return process_admin_command(ctx, sender, &text);
    }

    ctx.db.chat_message().insert(ChatMessage {
        id: 0,
        sender,
        sender_name: player.username,
        text,
        sent_at: ctx.timestamp,
    });

    Ok(())
}
