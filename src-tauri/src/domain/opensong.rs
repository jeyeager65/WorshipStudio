use std::collections::HashMap;

use crate::models::{Arrangement, SongBlock};

pub struct ParsedSong {
    pub title: String,
    pub author: Option<String>,
    pub copyright: Option<String>,
    pub ccli: Option<String>,
    pub blocks: Vec<SongBlock>,
    pub arrangement: Arrangement,
}

/// Parses OpenSong's song XML format: simple top-level tags for metadata, plus a single
/// `<lyrics>` blob where sections are marked inline as `[V1]`, `[C]`, `[B]`, etc. — not
/// separate XML elements. See OpenSong/Songs/* for real examples of this format.
pub fn parse(xml: &str) -> ParsedSong {
    let title = extract_tag(xml, "title").unwrap_or_else(|| "Imported Song".to_string());
    let author = extract_tag(xml, "author");
    let copyright = extract_tag(xml, "copyright");
    let ccli = extract_tag(xml, "ccli");
    let presentation = extract_tag(xml, "presentation");
    let (blocks, lyrics_arrangement) = extract_tag(xml, "lyrics")
        .map(|lyrics| parse_lyrics(&lyrics))
        .unwrap_or_default();

    // <presentation> (e.g. "V1 V2 V4") is OpenSong's own explicit default-arrangement field,
    // independent of <lyrics> — a block can be fully defined in <lyrics> for reference (e.g.
    // an unused verse kept around) without being part of the actual performed order. When
    // present it's authoritative; when absent, fall back to the order blocks were encountered
    // while scanning <lyrics> (which already captures repeats like a chorus reappearing).
    let arrangement = match presentation {
        Some(list) => {
            let sequence: Vec<String> = list
                .split_whitespace()
                .map(|tag| tag.to_lowercase())
                .filter(|id| blocks.iter().any(|block| &block.id == id))
                .collect();
            if sequence.is_empty() {
                lyrics_arrangement
            } else {
                Arrangement { sequence }
            }
        }
        None => lyrics_arrangement,
    };

    ParsedSong {
        title,
        author,
        copyright,
        ccli,
        blocks,
        arrangement,
    }
}

fn extract_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    let value = decode_xml_entities(xml[start..end].trim());
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

/// Parses OpenSong's inline `[TAG]` section markers within a lyrics blob into blocks plus
/// the arrangement (order of occurrence, repeats included). A tag that reappears with no
/// text beneath it before the next marker is OpenSong's shorthand for "repeat this section"
/// rather than a redefinition — it references the existing block instead of creating an
/// empty duplicate.
fn parse_lyrics(lyrics: &str) -> (Vec<SongBlock>, Arrangement) {
    let mut blocks: Vec<SongBlock> = Vec::new();
    let mut block_index: HashMap<String, usize> = HashMap::new();
    let mut sequence: Vec<String> = Vec::new();

    let mut current_tag: Option<String> = None;
    let mut current_lines: Vec<&str> = Vec::new();

    for line in lyrics.lines() {
        if let Some(tag) = tag_marker(line) {
            flush_section(
                &current_tag,
                &current_lines,
                &mut blocks,
                &mut block_index,
                &mut sequence,
            );
            current_tag = Some(tag);
            current_lines = Vec::new();
        } else {
            current_lines.push(line);
        }
    }
    flush_section(
        &current_tag,
        &current_lines,
        &mut blocks,
        &mut block_index,
        &mut sequence,
    );

    (blocks, Arrangement { sequence })
}

fn flush_section(
    current_tag: &Option<String>,
    current_lines: &[&str],
    blocks: &mut Vec<SongBlock>,
    block_index: &mut HashMap<String, usize>,
    sequence: &mut Vec<String>,
) {
    let Some(tag) = current_tag else { return };
    let id = tag.to_lowercase();
    // OpenSong prefixes every lyric line with a single leading space as a formatting
    // convention, not meaningful indentation — trim both ends of each line, not just the
    // trailing end of the whole block, or every line after the first keeps a stray space.
    let text = decode_xml_entities(
        current_lines
            .iter()
            .map(|line| line.trim())
            .collect::<Vec<_>>()
            .join("\n")
            .trim(),
    );

    if !text.is_empty() {
        match block_index.get(&id) {
            // A tag redefined with new text later in the file is unusual but not invalid —
            // the later text wins rather than erroring or silently keeping the first.
            Some(&idx) => blocks[idx].text = text,
            None => {
                block_index.insert(id.clone(), blocks.len());
                blocks.push(SongBlock {
                    id: id.clone(),
                    label: label_for_tag(tag),
                    text,
                });
            }
        }
        sequence.push(id);
    } else if block_index.contains_key(&id) {
        sequence.push(id);
    }
    // An empty tag that was never defined has nothing to repeat — skip it rather than
    // inventing a blank block.
}

fn tag_marker(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.len() > 2 && trimmed.starts_with('[') && trimmed.ends_with(']') {
        Some(trimmed[1..trimmed.len() - 1].to_string())
    } else {
        None
    }
}

/// Splits a section tag like "V1" into its letter prefix and trailing number, e.g. ("V", "1").
fn split_tag(tag: &str) -> (String, Option<String>) {
    let letters: String = tag.chars().take_while(|c| c.is_alphabetic()).collect();
    let digits: String = tag.chars().skip(letters.chars().count()).collect();
    let letters_len = letters.chars().count();
    if letters_len == 0 || digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        (tag.to_string(), None)
    } else {
        (letters.to_uppercase(), Some(digits))
    }
}

fn label_for_tag(tag: &str) -> String {
    let (letters, number) = split_tag(tag);
    let word = match letters.as_str() {
        "V" => Some("Verse"),
        "C" => Some("Chorus"),
        "B" => Some("Bridge"),
        "P" => Some("Pre-Chorus"),
        "I" => Some("Intro"),
        "O" => Some("Other"),
        "T" => Some("Tag"),
        "E" => Some("Ending"),
        _ => None,
    };
    match (word, number) {
        (Some(word), Some(n)) => format!("{word} {n}"),
        (Some(word), None) => word.to_string(),
        (None, _) => tag.to_string(),
    }
}

fn decode_xml_entities(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '&' {
            result.push(c);
            continue;
        }
        let mut entity = String::new();
        let mut closed = false;
        while let Some(&next) = chars.peek() {
            if next == ';' {
                chars.next();
                closed = true;
                break;
            }
            if next == '&' || entity.len() > 10 {
                break;
            }
            entity.push(next);
            chars.next();
        }
        if !closed {
            result.push('&');
            result.push_str(&entity);
            continue;
        }
        match entity.as_str() {
            "amp" => result.push('&'),
            "lt" => result.push('<'),
            "gt" => result.push('>'),
            "quot" => result.push('"'),
            "apos" => result.push('\''),
            _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                if let Some(ch) = u32::from_str_radix(&entity[2..], 16)
                    .ok()
                    .and_then(char::from_u32)
                {
                    result.push(ch);
                }
            }
            _ if entity.starts_with('#') => {
                if let Some(ch) = entity[1..].parse::<u32>().ok().and_then(char::from_u32) {
                    result.push(ch);
                }
            }
            _ => {
                // Unknown entity — preserve it literally rather than silently dropping data.
                result.push('&');
                result.push_str(&entity);
                result.push(';');
            }
        }
    }
    fix_cp1252_mojibake(result)
}

/// Repairs a common legacy encoding bug found in real OpenSong files: text originally
/// Windows-1252 (where 0x92 is a curly apostrophe, etc.) that got reinterpreted as
/// Latin-1/ISO-8859-1 somewhere along the way, producing real-but-invisible Unicode C1
/// control characters (U+0080–U+009F) instead of the intended punctuation — this is what
/// renders as a tofu/rectangle glyph rather than an apostrophe. Only the well-known
/// printable cp1252 mappings are repaired; the handful of codepoints undefined in cp1252
/// are left as-is since there's no way to know what was intended.
fn fix_cp1252_mojibake(input: String) -> String {
    input
        .chars()
        .map(|c| {
            let code = c as u32;
            if (0x80..=0x9F).contains(&code) {
                cp1252_control_replacement(code as u8).unwrap_or(c)
            } else {
                c
            }
        })
        .collect()
}

fn cp1252_control_replacement(byte: u8) -> Option<char> {
    match byte {
        0x80 => Some('€'),
        0x82 => Some('\u{201A}'),
        0x83 => Some('\u{0192}'),
        0x84 => Some('\u{201E}'),
        0x85 => Some('\u{2026}'),
        0x86 => Some('\u{2020}'),
        0x87 => Some('\u{2021}'),
        0x88 => Some('\u{02C6}'),
        0x89 => Some('\u{2030}'),
        0x8A => Some('\u{0160}'),
        0x8B => Some('\u{2039}'),
        0x8C => Some('\u{0152}'),
        0x8E => Some('\u{017D}'),
        0x91 => Some('\u{2018}'),
        0x92 => Some('\u{2019}'),
        0x93 => Some('\u{201C}'),
        0x94 => Some('\u{201D}'),
        0x95 => Some('\u{2022}'),
        0x96 => Some('\u{2013}'),
        0x97 => Some('\u{2014}'),
        0x98 => Some('\u{02DC}'),
        0x99 => Some('\u{2122}'),
        0x9A => Some('\u{0161}'),
        0x9B => Some('\u{203A}'),
        0x9C => Some('\u{0153}'),
        0x9E => Some('\u{017E}'),
        0x9F => Some('\u{0178}'),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_real_opensong_amazing_grace() {
        // Verbatim content from OpenSong/Songs/Amazing Grace (public-domain hymn text) —
        // hardcoded here rather than read from disk since that folder is gitignored and
        // wouldn't exist in a CI checkout.
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<song>
  <title>Amazing Grace</title>
  <author></author>
  <copyright></copyright>
  <hymn_number></hymn_number>
  <presentation></presentation>
  <ccli></ccli>
  <capo print="false"></capo>
  <key></key>
  <aka></aka>
  <key_line></key_line>
  <user1></user1>
  <user2></user2>
  <user3></user3>
  <theme></theme>
  <tempo></tempo>
  <time_sig></time_sig>
  <lyrics>[V1]
 Amazing Grace, how sweet the sound,
 That saved a wretch like me.
 I once was lost but now am found,
 Was blind, but now I see.

[V2]
 T'was Grace that taught my heart to fear.
 And Grace, my fears relieved.
 How precious did that Grace appear
 The hour I first believed.

[V3]
 Through many dangers, toils and snares
 I have already come;
 'Tis Grace that brought me safe thus far
 and Grace will lead me home.

[V4]
 When we've been there ten thousand years
 Bright shining as the sun.
 We've no less days to sing God's praise
 Than when we'd first begun.

[O]
 I once was lost but now am found,
 Was blind, but now I see.
 </lyrics>
  <linked_songs/>
  <backgrounds resize="screen" keep_aspect="false" link="false" background_as_text="false"/>
</song>"#;

        let parsed = parse(xml);
        assert_eq!(parsed.title, "Amazing Grace");
        assert_eq!(parsed.author, None); // empty tags decode to None, not ""
        assert_eq!(parsed.blocks.len(), 5);
        assert_eq!(parsed.blocks[0].id, "v1");
        assert_eq!(parsed.blocks[0].label, "Verse 1");
        assert!(parsed.blocks[0]
            .text
            .starts_with("Amazing Grace, how sweet the sound"));
        assert_eq!(parsed.blocks[4].label, "Other");
        assert_eq!(
            parsed.arrangement.sequence,
            vec!["v1", "v2", "v3", "v4", "o"]
        );
    }

    #[test]
    fn extracts_populated_metadata_fields() {
        let xml = "<song><title>Great Are You Lord</title><author>Leonard, MacIntyre, Jordan</author><ccli>7036939</ccli><key>A</key><lyrics></lyrics></song>";
        let parsed = parse(xml);
        assert_eq!(parsed.title, "Great Are You Lord");
        assert_eq!(parsed.author.as_deref(), Some("Leonard, MacIntyre, Jordan"));
        assert_eq!(parsed.ccli.as_deref(), Some("7036939"));
    }

    #[test]
    fn falls_back_to_placeholder_title_when_missing() {
        let parsed = parse("<song><lyrics></lyrics></song>");
        assert_eq!(parsed.title, "Imported Song");
    }

    #[test]
    fn empty_tag_marker_repeats_the_earlier_block_without_duplicating() {
        let xml = "<song><title>Test</title><lyrics>[C]\nGreat are You Lord\n\n[V1]\nVerse text\n\n[C]\n</lyrics></song>";
        let parsed = parse(xml);
        assert_eq!(parsed.blocks.len(), 2);
        assert_eq!(parsed.arrangement.sequence, vec!["c", "v1", "c"]);
    }

    #[test]
    fn decodes_common_xml_entities_and_apostrophes() {
        let xml = "<song><title>Test</title><lyrics>[V1]\nRock &amp; Redeemer&apos;s &quot;Grace&quot; &#8217;tis &lt;free&gt;\n</lyrics></song>";
        let parsed = parse(xml);
        assert_eq!(
            parsed.blocks[0].text,
            "Rock & Redeemer's \"Grace\" \u{2019}tis <free>"
        );
    }

    #[test]
    fn leading_space_on_each_lyric_line_is_trimmed() {
        // Real OpenSong files prefix every lyric line with a single space as a formatting
        // convention (see the Amazing Grace fixture above) — it shouldn't survive into the
        // parsed block text.
        let xml = "<song><title>Test</title><lyrics>[V1]\n Line one\n Line two\n</lyrics></song>";
        let parsed = parse(xml);
        assert_eq!(parsed.blocks[0].text, "Line one\nLine two");
    }

    #[test]
    fn repairs_windows_1252_mojibake_control_characters() {
        // A curly apostrophe (cp1252 0x92) that got mis-decoded as the Unicode C1 control
        // character U+0092 along the way — a real bug found in an imported song where it
        // rendered as an invisible/tofu box instead of an apostrophe.
        let mangled = "It\u{0092}s finished";
        let xml = format!("<song><title>Test</title><lyrics>[V1]\n{mangled}\n</lyrics></song>");
        let parsed = parse(&xml);
        assert_eq!(parsed.blocks[0].text, "It\u{2019}s finished");
    }

    #[test]
    fn unrecognized_tag_falls_back_to_raw_text_as_label() {
        let xml = "<song><title>Test</title><lyrics>[X9]\nSome text\n</lyrics></song>";
        let parsed = parse(xml);
        assert_eq!(parsed.blocks[0].label, "X9");
        assert_eq!(parsed.blocks[0].id, "x9");
    }

    #[test]
    fn a_tag_with_no_text_and_never_defined_is_skipped() {
        let xml = "<song><title>Test</title><lyrics>[C]\n</lyrics></song>";
        let parsed = parse(xml);
        assert!(parsed.blocks.is_empty());
        assert!(parsed.arrangement.sequence.is_empty());
    }

    #[test]
    fn presentation_field_overrides_lyrics_order_and_can_skip_a_defined_block() {
        // Real structure from OpenSong/Songs/Ah, Holy Jesus — V3 is fully written out in
        // <lyrics> (kept for reference) but <presentation> shows it's not actually sung.
        let xml = "<song><title>Ah, Holy Jesus</title><presentation>V1 V2 V4</presentation><lyrics>[V1]\nA\n\n[V2]\nB\n\n[V3]\nC\n\n[V4]\nD</lyrics></song>";
        let parsed = parse(xml);
        assert_eq!(
            parsed.blocks.len(),
            4,
            "all four verses are still defined as blocks"
        );
        assert_eq!(
            parsed.arrangement.sequence,
            vec!["v1", "v2", "v4"],
            "but V3 is excluded from the arrangement"
        );
    }

    #[test]
    fn presentation_field_supports_repeats() {
        // Real structure from OpenSong/Songs/All I Have Is Christ.
        let xml = "<song><title>Test</title><presentation>C V1 V2 C V3 C</presentation><lyrics>[C]\nChorus\n\n[V1]\nOne\n\n[V2]\nTwo\n\n[V3]\nThree</lyrics></song>";
        let parsed = parse(xml);
        assert_eq!(
            parsed.arrangement.sequence,
            vec!["c", "v1", "v2", "c", "v3", "c"]
        );
    }

    #[test]
    fn presentation_referencing_an_unknown_tag_drops_only_that_entry() {
        let xml = "<song><title>Test</title><presentation>V1 V9 V2</presentation><lyrics>[V1]\nA\n\n[V2]\nB</lyrics></song>";
        let parsed = parse(xml);
        assert_eq!(parsed.arrangement.sequence, vec!["v1", "v2"]);
    }

    #[test]
    fn empty_presentation_falls_back_to_lyrics_derived_order() {
        let xml = "<song><title>Test</title><presentation></presentation><lyrics>[V1]\nA\n\n[V2]\nB</lyrics></song>";
        let parsed = parse(xml);
        assert_eq!(parsed.arrangement.sequence, vec!["v1", "v2"]);
    }

    /// Real-data smoke test against a handful of actual files from OpenSong/Songs — not just
    /// hand-typed fixtures. Ignored by default (and thus never run in CI) because that folder
    /// is gitignored and only exists on a machine with the real church library checked out
    /// locally; run explicitly with `cargo test -- --ignored` when it's present.
    #[test]
    #[ignore]
    fn real_opensong_files_parse_without_panicking() {
        let songs_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../OpenSong/Songs");
        let samples = [
            ("Amazing Grace", "Amazing Grace"),
            ("10,000 Reasons", "10,000 Reasons"),
            ("All I Have Is Christ", "All I Have Is Christ"),
            ("Ah, Holy Jesus", "Ah, Holy Jesus"),
            ("Apostles Creed", "Apostles Creed"),
        ];
        for (filename, expected_title) in samples {
            let path = songs_dir.join(filename);
            let xml = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("couldn't read {path:?}: {e}"));
            let parsed = parse(&xml);
            assert_eq!(parsed.title, expected_title);
            assert!(
                !parsed.blocks.is_empty(),
                "{filename} should have at least one block"
            );
            assert!(
                !parsed.arrangement.sequence.is_empty(),
                "{filename} should have a non-empty arrangement"
            );
            for id in &parsed.arrangement.sequence {
                assert!(
                    parsed.blocks.iter().any(|b| &b.id == id),
                    "{filename}: arrangement references block '{id}' that isn't in blocks"
                );
            }
        }
    }
}
