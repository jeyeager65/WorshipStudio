use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;

use crate::models::{
    BibleBookRef, ScripturePassage, ScripturePassageVerse, ScriptureReference, ScriptureTranslation,
};

/// Book/chapter/verse-count reference table — same data as src/data/bibleBooks.json on the
/// frontend (see src/utils/scriptureReference.ts), embedded here so validation/wayfinding
/// works without a round trip to the frontend for pure reference data.
static BIBLE_BOOKS: LazyLock<Vec<BibleBookRef>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../data/bible_books.json"))
        .expect("bible_books.json must parse")
});

/// Complete King James Version text (public domain — no API key or attribution required,
/// unlike ESV below), embedded so KJV always resolves offline. Source: the well-known
/// aruljohn/Bible-kjv dataset, reshaped to book -> chapter -> verse -> text and validated
/// against BIBLE_BOOKS' own chapter/verse counts at build time (every book matched exactly).
/// Same data lives at src/adapters/mock/kjvFull.json for the browser demo/mock adapter.
type Kjv = HashMap<String, HashMap<String, HashMap<String, String>>>;
static KJV: LazyLock<Kjv> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../data/kjv.json")).expect("kjv.json must parse")
});

fn normalize(text: &str) -> String {
    text.trim().to_lowercase().replace('.', "")
}

/// Common alternate spellings that don't match a book's canonical name or abbreviation.
fn book_alias(normalized: &str) -> Option<&'static str> {
    match normalized {
        "psalms" => Some("Psalm"),
        "revelations" => Some("Revelation"),
        "song of songs" => Some("Song of Solomon"),
        "canticles" => Some("Song of Solomon"),
        _ => None,
    }
}

pub fn find_book(name: &str) -> Option<&'static BibleBookRef> {
    let normalized = normalize(name);
    if normalized.is_empty() {
        return None;
    }
    let aliased = book_alias(&normalized);
    BIBLE_BOOKS.iter().find(|b| {
        normalize(&b.name) == normalized
            || normalize(&b.abbr) == normalized
            || aliased == Some(b.name.as_str())
    })
}

pub fn get_book_names() -> Vec<String> {
    BIBLE_BOOKS.iter().map(|b| b.name.clone()).collect()
}

pub fn get_verse_count(book_name: &str, chapter: u32) -> u32 {
    find_book(book_name)
        .and_then(|b| {
            chapter
                .checked_sub(1)
                .and_then(|i| b.chapters.get(i as usize))
        })
        .copied()
        .unwrap_or(0)
}

fn is_valid_chapter_verse(book: &BibleBookRef, chapter: u32, verse: u32) -> bool {
    let verse_count = chapter
        .checked_sub(1)
        .and_then(|i| book.chapters.get(i as usize));
    match verse_count {
        Some(&count) => verse >= 1 && verse <= count,
        None => false,
    }
}

/// Validates a reference's book/chapter/verse against the reference table (spec section 1)
/// — used both for "Type a reference" free-text validation and "Choose fields" cascading
/// dropdown population, so an invalid reference is never selectable either way.
pub fn is_valid_reference(reference: &ScriptureReference) -> bool {
    let Some(book) = find_book(&reference.book) else {
        return false;
    };
    if !is_valid_chapter_verse(book, reference.start_chapter, reference.start_verse) {
        return false;
    }
    if !is_valid_chapter_verse(book, reference.end_chapter, reference.end_verse) {
        return false;
    }
    if reference.end_chapter < reference.start_chapter {
        return false;
    }
    if reference.end_chapter == reference.start_chapter
        && reference.end_verse < reference.start_verse
    {
        return false;
    }
    true
}

// Matches "Book C", "Book C:V", "Book C:V-V2", "Book C:V-C2:V2" — book name is everything
// before the trailing chapter/verse numbers, so it naturally handles multi-word and
// numbered-prefix book names ("1 Corinthians", "Song of Solomon") without a fixed list.
static REFERENCE_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(.+?)\s+(\d+)(?:\s*:\s*(\d+)(?:\s*-\s*(?:(\d+)\s*:\s*)?(\d+))?)?\s*$")
        .expect("reference pattern must compile")
});

/// Parses a free-text reference like "John 3:16-17" or "John 3:16-4:2" (spec section 2,
/// "Type a reference" mode). Returns `None` if the text doesn't look like a reference at
/// all, or refers to an unknown book — callers should distinguish that from a
/// structurally-valid-but-out-of-range reference via `is_valid_reference`, so the UI can
/// show "verse out of range" instead of a generic parse failure.
///
/// A bare "Book C" (no verse) resolves to the whole chapter. Disjoint multi-clause
/// references (e.g. "Psalm 135:3, 5-7") are out of scope for this parser, matching the
/// frontend's own parser exactly (see src/utils/scriptureReference.ts).
pub fn parse_reference(text: &str) -> Option<ScriptureReference> {
    let captures = REFERENCE_PATTERN.captures(text.trim())?;
    let book_text = captures.get(1)?.as_str();
    let book = find_book(book_text)?;

    let start_chapter: u32 = captures.get(2)?.as_str().parse().ok()?;
    let start_verse_text = captures.get(3).map(|m| m.as_str());
    let start_verse: u32 = start_verse_text
        .map(|v| v.parse().ok())
        .unwrap_or(Some(1))?;
    let end_chapter: u32 = captures
        .get(4)
        .map(|m| m.as_str().parse().ok())
        .unwrap_or(Some(start_chapter))?;
    let end_verse: u32 = match captures.get(5) {
        Some(m) => m.as_str().parse().ok()?,
        None if start_verse_text.is_some() => start_verse,
        None => get_verse_count(&book.name, start_chapter).max(start_verse),
    };

    Some(ScriptureReference {
        book: book.name.clone(),
        start_chapter,
        start_verse,
        end_chapter,
        end_verse,
    })
}

pub fn format_reference(reference: &ScriptureReference) -> String {
    let whole_chapter = reference.start_verse == 1
        && reference.end_chapter == reference.start_chapter
        && reference.end_verse == get_verse_count(&reference.book, reference.start_chapter);
    if whole_chapter {
        return format!("{} {}", reference.book, reference.start_chapter);
    }
    if reference.start_chapter == reference.end_chapter {
        return if reference.start_verse == reference.end_verse {
            format!(
                "{} {}:{}",
                reference.book, reference.start_chapter, reference.start_verse
            )
        } else {
            format!(
                "{} {}:{}-{}",
                reference.book, reference.start_chapter, reference.start_verse, reference.end_verse
            )
        };
    }
    format!(
        "{} {}:{}-{}:{}",
        reference.book,
        reference.start_chapter,
        reference.start_verse,
        reference.end_chapter,
        reference.end_verse
    )
}

/// Resolves against the embedded complete KJV text. `translation_code` is only echoed back
/// into the response (mirroring the mock adapter) — KJV is the only locally-resolved
/// translation today, so anything reaching this function is treated as KJV regardless of
/// the exact code passed in.
pub fn resolve(reference_text: &str, translation_code: &str) -> Result<ScripturePassage, String> {
    let parsed = parse_reference(reference_text)
        .filter(is_valid_reference)
        .ok_or_else(|| format!("\"{reference_text}\" isn't a valid scripture reference."))?;

    let book_data = KJV.get(&parsed.book);
    let mut verses = Vec::new();
    for chapter in parsed.start_chapter..=parsed.end_chapter {
        let verse_from = if chapter == parsed.start_chapter {
            parsed.start_verse
        } else {
            1
        };
        let verse_to = if chapter == parsed.end_chapter {
            parsed.end_verse
        } else {
            u32::MAX
        };
        let Some(chapter_data) = book_data.and_then(|b| b.get(&chapter.to_string())) else {
            continue;
        };
        for (verse_text, text) in chapter_data {
            let Ok(number) = verse_text.parse::<u32>() else {
                continue;
            };
            if number >= verse_from && number <= verse_to {
                verses.push(ScripturePassageVerse {
                    number,
                    text: text.clone(),
                });
            }
        }
    }
    verses.sort_by_key(|v| v.number);

    if verses.is_empty() {
        // Every book/chapter/verse in BIBLE_BOOKS was validated against this exact dataset
        // when it was built (see the KJV doc comment above), so a valid reference reaching
        // here and still coming up empty would mean the embedded data itself is corrupt.
        return Err(format!(
            "No KJV text found for {} — this shouldn't happen.",
            format_reference(&parsed)
        ));
    }

    Ok(ScripturePassage {
        reference: format_reference(&parsed),
        translation: translation_code.to_string(),
        verses,
        // Public domain — no attribution required, unlike ESV below.
        copyright: None,
    })
}

/// Matches a leading "[16] " verse-number marker in ESV API text (include-verse-numbers=true)
/// — everything up to the next marker (or end of string) is that verse's text.
static ESV_VERSE_MARKER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[(\d+)\]\s*").expect("verse marker pattern must compile"));

#[derive(serde::Deserialize)]
struct EsvPassageResponse {
    passages: Vec<String>,
}

/// Real ESV API fetch (https://api.esv.org/docs/passage-text/) — see docs/release-process.md
/// sibling note in Settings (Bible Translations) for the attribution this requires. Verse
/// numbers are requested so the flat text can be split back into the same
/// `Vec<ScripturePassageVerse>` shape the local KJV sample and the rest of the app already
/// use; footnotes/headings/references are excluded since this app displays verse text only.
pub async fn resolve_esv(reference_text: &str, api_key: &str) -> Result<ScripturePassage, String> {
    let parsed = parse_reference(reference_text)
        .filter(is_valid_reference)
        .ok_or_else(|| format!("\"{reference_text}\" isn't a valid scripture reference."))?;
    let canonical_reference = format_reference(&parsed);

    let client = reqwest::Client::new();
    let response = client
        .get("https://api.esv.org/v3/passage/text/")
        .header("Authorization", format!("Token {api_key}"))
        .query(&[
            ("q", canonical_reference.as_str()),
            ("include-passage-references", "false"),
            ("include-verse-numbers", "true"),
            ("include-footnotes", "false"),
            ("include-headings", "false"),
            ("include-short-copyright", "false"),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to reach the ESV API: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("ESV API request failed ({}).", response.status()));
    }

    let body: EsvPassageResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse the ESV API response: {e}"))?;
    let text = body
        .passages
        .first()
        .ok_or_else(|| format!("The ESV API returned no text for {canonical_reference}."))?;

    // Splits the flat "[16] text [17] text..." response on each verse-number marker, pairing
    // it with the text run up to the next marker (or end of string).
    let mut verses = Vec::new();
    let mut last_end = 0usize;
    let mut pending_number: Option<u32> = None;
    for m in ESV_VERSE_MARKER.captures_iter(text) {
        let whole = m.get(0).expect("group 0 always matches");
        if let Some(number) = pending_number {
            let segment = text[last_end..whole.start()].trim();
            verses.push(ScripturePassageVerse {
                number,
                text: segment.to_string(),
            });
        }
        pending_number = m.get(1).and_then(|n| n.as_str().parse().ok());
        last_end = whole.end();
    }
    if let Some(number) = pending_number {
        let segment = text[last_end..].trim();
        verses.push(ScripturePassageVerse {
            number,
            text: segment.to_string(),
        });
    }

    if verses.is_empty() {
        return Err(format!(
            "The ESV API returned no verse text for {canonical_reference}."
        ));
    }

    Ok(ScripturePassage {
        reference: canonical_reference,
        translation: "ESV".to_string(),
        verses,
        // Compact per-quotation designator (ESV API terms: "include the letters 'ESV'" with
        // each quotation) — the full copyright/permission notice is shown once, in Settings'
        // Bible Translations section, not repeated on every passage/live slide.
        copyright: Some("(ESV)".to_string()),
    })
}

pub fn list_translations(esv_api_key_configured: bool) -> Vec<ScriptureTranslation> {
    let mut translations = vec![ScriptureTranslation {
        code: "KJV".to_string(),
        name: "King James Version".to_string(),
    }];
    if esv_api_key_configured {
        translations.push(ScriptureTranslation {
            code: "ESV".to_string(),
            name: "English Standard Version".to_string(),
        });
    }
    translations
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_book_matches_by_canonical_name_case_insensitively() {
        assert_eq!(find_book("john").unwrap().name, "John");
    }

    #[test]
    fn find_book_matches_by_abbreviation() {
        assert_eq!(find_book("Gen").unwrap().name, "Genesis");
    }

    #[test]
    fn find_book_matches_numbered_books() {
        assert_eq!(find_book("1 Corinthians").unwrap().name, "1 Corinthians");
    }

    #[test]
    fn find_book_matches_common_aliases() {
        assert_eq!(find_book("Psalms").unwrap().name, "Psalm");
        assert_eq!(find_book("Revelations").unwrap().name, "Revelation");
    }

    #[test]
    fn find_book_returns_none_for_unknown_book() {
        assert!(find_book("Not A Book").is_none());
    }

    #[test]
    fn reports_correct_verse_count_for_a_chapter() {
        assert_eq!(get_verse_count("John", 3), 36);
        assert_eq!(get_verse_count("Genesis", 1), 31);
    }

    fn reference(book: &str, sc: u32, sv: u32, ec: u32, ev: u32) -> ScriptureReference {
        ScriptureReference {
            book: book.to_string(),
            start_chapter: sc,
            start_verse: sv,
            end_chapter: ec,
            end_verse: ev,
        }
    }

    #[test]
    fn parses_a_single_verse() {
        assert_eq!(
            parse_reference("John 3:16"),
            Some(reference("John", 3, 16, 3, 16))
        );
    }

    #[test]
    fn parses_a_verse_range_within_one_chapter() {
        assert_eq!(
            parse_reference("John 3:16-17"),
            Some(reference("John", 3, 16, 3, 17))
        );
    }

    #[test]
    fn parses_a_range_crossing_chapters() {
        assert_eq!(
            parse_reference("John 3:16-4:2"),
            Some(reference("John", 3, 16, 4, 2))
        );
    }

    #[test]
    fn parses_a_whole_chapter_reference_with_no_verse_given() {
        assert_eq!(
            parse_reference("Psalm 23"),
            Some(reference("Psalm", 23, 1, 23, 6))
        );
    }

    #[test]
    fn parses_a_multi_word_numbered_book_name() {
        assert_eq!(
            parse_reference("1 Corinthians 13:4-7"),
            Some(reference("1 Corinthians", 13, 4, 13, 7))
        );
    }

    #[test]
    fn returns_none_for_an_unrecognized_book() {
        assert_eq!(parse_reference("Not A Book 1:1"), None);
    }

    #[test]
    fn returns_none_for_text_with_no_chapter_verse_numbers() {
        assert_eq!(parse_reference("John"), None);
    }

    #[test]
    fn accepts_a_reference_within_bounds() {
        assert!(is_valid_reference(&reference("John", 3, 16, 3, 17)));
    }

    #[test]
    fn rejects_a_verse_beyond_the_chapter_length() {
        assert!(!is_valid_reference(&reference("John", 3, 1, 3, 999)));
    }

    #[test]
    fn rejects_a_chapter_beyond_the_book_length() {
        assert!(!is_valid_reference(&reference("Jude", 2, 1, 2, 1)));
    }

    #[test]
    fn rejects_an_end_that_comes_before_the_start() {
        assert!(!is_valid_reference(&reference("John", 3, 20, 3, 16)));
    }

    #[test]
    fn rejects_an_unknown_book() {
        assert!(!is_valid_reference(&reference("Not A Book", 1, 1, 1, 1)));
    }

    #[test]
    fn formats_a_single_verse() {
        assert_eq!(
            format_reference(&reference("John", 3, 16, 3, 16)),
            "John 3:16"
        );
    }

    #[test]
    fn formats_a_range_within_one_chapter() {
        assert_eq!(
            format_reference(&reference("John", 3, 16, 3, 17)),
            "John 3:16-17"
        );
    }

    #[test]
    fn formats_a_range_crossing_chapters() {
        assert_eq!(
            format_reference(&reference("John", 3, 16, 4, 2)),
            "John 3:16-4:2"
        );
    }

    #[test]
    fn formats_a_whole_chapter_without_a_verse_range() {
        assert_eq!(
            format_reference(&reference("Psalm", 23, 1, 23, 6)),
            "Psalm 23"
        );
    }

    #[test]
    fn resolves_a_known_passage() {
        let passage = resolve("John 3:16-17", "KJV").unwrap();
        assert_eq!(passage.reference, "John 3:16-17");
        assert_eq!(passage.translation, "KJV");
        assert_eq!(passage.verses.len(), 2);
        assert_eq!(passage.verses[0].number, 16);
        assert!(passage.verses[0]
            .text
            .contains("For God so loved the world"));
        assert!(passage.copyright.is_none());
    }

    #[test]
    fn resolves_the_first_and_last_verses_of_the_whole_bible() {
        // Full-coverage sanity check, not just the handful of well-known passages above.
        assert!(resolve("Genesis 1:1", "KJV").is_ok());
        assert!(resolve("Revelation 22:21", "KJV").is_ok());
    }

    #[test]
    fn resolve_rejects_an_invalid_reference() {
        assert!(resolve("Not A Book 1:1", "KJV").is_err());
    }

    /// Hits the real ESV API — needs ESV_API_KEY set (see docs/release-process.md and the
    /// .env this crate's lib.rs loads at startup). Not run by default in CI or a normal
    /// `cargo test`; run explicitly with `cargo test -- --ignored` when verifying the
    /// integration itself, e.g. after changing the request/response handling.
    #[tokio::test]
    #[ignore]
    async fn resolve_esv_fetches_and_parses_a_real_passage() {
        // `cargo test` never runs lib.rs's run(), so load .env here too rather than requiring
        // ESV_API_KEY to already be set in the shell.
        let _ = dotenvy::dotenv();
        let _ = dotenvy::from_filename("../.env");
        let api_key =
            std::env::var("ESV_API_KEY").expect("ESV_API_KEY must be set to run this test");
        let passage = resolve_esv("John 3:16-17", &api_key).await.unwrap();
        assert_eq!(passage.reference, "John 3:16-17");
        assert_eq!(passage.translation, "ESV");
        assert_eq!(passage.copyright.as_deref(), Some("(ESV)"));
        assert_eq!(passage.verses.len(), 2);
        assert_eq!(passage.verses[0].number, 16);
        assert!(passage.verses[0]
            .text
            .contains("For God so loved the world"));
        assert_eq!(passage.verses[1].number, 17);
        assert!(passage.verses[1]
            .text
            .contains("For God did not send his Son"));
        // No verse should retain a stray marker or leak into its neighbor.
        assert!(!passage.verses[0].text.contains('['));
        assert!(!passage.verses[1].text.contains('['));
    }
}
