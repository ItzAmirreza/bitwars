// ── Chat Moderation Helpers ──
// Shared heuristics for keeping public chat readable.

use std::collections::HashSet;

pub fn normalize_chat_text(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn find_chat_spam_issue(text: &str) -> Option<&'static str> {
    let visible_chars: Vec<char> = text.chars().filter(|ch| !ch.is_whitespace()).collect();
    let visible_len = visible_chars.len();

    if visible_len >= 12 && longest_char_run(&visible_chars) >= 9 {
        return Some("Message looks spammy. Tone it down.");
    }

    if longest_word_run(text) >= 4 {
        return Some("Please don't flood repeated words.");
    }

    if visible_len >= 18 {
        let unique_chars: HashSet<char> = visible_chars.iter().copied().collect();
        if unique_chars.len() <= 3 {
            return Some("Message looks spammy. Tone it down.");
        }
    }

    if visible_len >= 16 {
        let symbol_count = visible_chars
            .iter()
            .filter(|ch| !ch.is_alphanumeric())
            .count();
        if symbol_count * 10 >= visible_len * 7 {
            return Some("Please use words instead of symbol spam.");
        }
    }

    None
}

fn longest_char_run(chars: &[char]) -> usize {
    let mut max_run = 0usize;
    let mut current_run = 0usize;
    let mut previous = None;

    for ch in chars {
        if Some(*ch) == previous {
            current_run += 1;
        } else {
            previous = Some(*ch);
            current_run = 1;
        }
        max_run = max_run.max(current_run);
    }

    max_run
}

fn longest_word_run(text: &str) -> usize {
    let mut max_run = 0usize;
    let mut current_run = 0usize;
    let mut previous = String::new();

    for token in text.split_whitespace() {
        let normalized = token.to_lowercase();
        if normalized == previous {
            current_run += 1;
        } else {
            previous = normalized;
            current_run = 1;
        }
        max_run = max_run.max(current_run);
    }

    max_run
}
