use std::path::Path;

use serde::Serialize;

use super::media::{self, MediaImportCommit};
use super::themes;

/// One of the 6 stock background images bundled with the app (see
/// scripts/optimize-stock-backgrounds.mjs, which produces the .webp files this refers to by
/// filename under the app's resource directory). Kept in sync by hand with the parallel list in
/// src/data/stockContent.ts — see plans/snoopy-wishing-cocke.md for why this isn't a shared
/// generated manifest.
pub struct StockBackground {
    pub id: &'static str,
    pub filename: &'static str,
    pub title: &'static str,
}

pub fn stock_backgrounds() -> &'static [StockBackground] {
    &[
        StockBackground {
            id: "media-stock-golden-cross-over-misty-mountains",
            filename: "golden-cross-over-misty-mountains.webp",
            title: "Golden Cross Over Misty Mountains",
        },
        StockBackground {
            id: "media-stock-golden-mist-over-the-lake",
            filename: "golden-mist-over-the-lake.webp",
            title: "Golden Mist Over the Lake",
        },
        StockBackground {
            id: "media-stock-golden-sunrise-reading-vista",
            filename: "golden-sunrise-reading-vista.webp",
            title: "Golden Sunrise Reading Vista",
        },
        StockBackground {
            id: "media-stock-misty-lake-at-dawn",
            filename: "misty-lake-at-dawn.webp",
            title: "Misty Lake at Dawn",
        },
        StockBackground {
            id: "media-stock-misty-meadow-at-sunrise",
            filename: "misty-meadow-at-sunrise.webp",
            title: "Misty Meadow at Sunrise",
        },
        StockBackground {
            id: "media-stock-misty-woodland-creek",
            filename: "misty-woodland-creek.webp",
            title: "Misty Woodland Creek",
        },
    ]
}

/// One of the 2 starter themes backed by a stock background. `intended_defaults` are
/// PresentationThemeTarget strings ("songs"/"scripture"/"sermon"/"text-slides") this theme
/// claims as its default *only if no existing theme already claims that target* — see
/// `import` below.
pub struct StockTheme {
    pub id: &'static str,
    pub name: &'static str,
    pub background_media_id: &'static str,
    pub font: &'static str,
    pub text_color: &'static str,
    pub intended_defaults: &'static [&'static str],
}

pub fn stock_themes() -> &'static [StockTheme] {
    &[
        StockTheme {
            id: "theme-stock-golden-cross",
            name: "Golden Cross",
            background_media_id: "media-stock-golden-cross-over-misty-mountains",
            font: "Montserrat",
            text_color: "#FFFFFF",
            intended_defaults: &["songs", "scripture", "sermon"],
        },
        StockTheme {
            id: "theme-stock-misty-dawn",
            name: "Misty Dawn",
            background_media_id: "media-stock-misty-lake-at-dawn",
            font: "Montserrat",
            text_color: "#FFFFFF",
            intended_defaults: &["text-slides"],
        },
    ]
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockImportSummary {
    pub media_added: u32,
    pub themes_added: u32,
}

/// Copies whichever of the 6 stock backgrounds aren't already in the library into its real
/// synced media folder — an ordinary import (`location: "synced"`, tagged Background/Stock),
/// not a special read-only concept, so once added they're indistinguishable from anything the
/// church imported themselves. Then adds whichever of the 2 starter themes aren't already
/// present, each only claiming a content type as its default when no existing theme already
/// owns it (mirrors ThemeEditorView.vue's "only one default may own a content type" invariant,
/// but conservatively — never steals an existing church's chosen default).
///
/// Idempotent: every image/theme has a fixed id, checked against the current library before
/// creating anything, so running this again after some or all of them already exist only adds
/// what's still missing.
pub fn import(
    root: &Path,
    local_media_root: &Path,
    resource_dir: &Path,
    device: &str,
    now: &str,
) -> std::io::Result<StockImportSummary> {
    let existing_media = media::list(root)?;
    let to_import: Vec<MediaImportCommit> = stock_backgrounds()
        .iter()
        .filter(|background| !existing_media.iter().any(|item| item.id == background.id))
        .map(|background| MediaImportCommit {
            path: resource_dir
                .join(background.filename)
                .to_string_lossy()
                .to_string(),
            filename: background.filename.to_string(),
            title: background.title.to_string(),
            description: None,
            tags: vec!["Background".to_string(), "Stock".to_string()],
            location: "synced".to_string(),
            duplicate_of_id: None,
            id: Some(background.id.to_string()),
        })
        .collect();
    let media_added = to_import.len() as u32;
    if !to_import.is_empty() {
        media::commit_imports(root, local_media_root, to_import, device, now)?;
    }

    let existing_themes = themes::list(root)?;
    let claimed_defaults: std::collections::HashSet<&str> = existing_themes
        .iter()
        .flat_map(|theme| theme.use_as_default_for.iter().map(String::as_str))
        .collect();

    let mut themes_added = 0u32;
    for stock_theme in stock_themes() {
        if existing_themes
            .iter()
            .any(|theme| theme.id == stock_theme.id)
        {
            continue;
        }
        let use_as_default_for = stock_theme
            .intended_defaults
            .iter()
            .filter(|target| !claimed_defaults.contains(*target))
            .map(|target| target.to_string())
            .collect();
        themes::save(
            root,
            crate::models::Theme {
                id: stock_theme.id.to_string(),
                name: stock_theme.name.to_string(),
                background_color: None,
                background_id: Some(stock_theme.background_media_id.to_string()),
                font: stock_theme.font.to_string(),
                text_color: stock_theme.text_color.to_string(),
                text_effect: None,
                outline: true,
                applies_to: Vec::new(),
                use_as_default_for,
                updated_at: String::new(),
                updated_by_device: String::new(),
            },
            device,
            now,
        )?;
        themes_added += 1;
    }

    Ok(StockImportSummary {
        media_added,
        themes_added,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Theme;

    fn theme_with_defaults(id: &str, defaults: &[&str]) -> Theme {
        Theme {
            id: id.to_string(),
            name: id.to_string(),
            background_color: None,
            background_id: None,
            font: "Inter".to_string(),
            text_color: "#FFFFFF".to_string(),
            text_effect: None,
            outline: false,
            applies_to: Vec::new(),
            use_as_default_for: defaults.iter().map(|s| s.to_string()).collect(),
            updated_at: String::new(),
            updated_by_device: String::new(),
        }
    }

    fn write_resource_files(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        for background in stock_backgrounds() {
            std::fs::write(dir.join(background.filename), b"stub pixels").unwrap();
        }
    }

    #[test]
    fn adds_every_stock_background_and_theme_on_a_fresh_library() {
        let root = tempfile::tempdir().unwrap();
        let local = tempfile::tempdir().unwrap();
        let resources = tempfile::tempdir().unwrap();
        write_resource_files(resources.path());

        let summary = import(root.path(), local.path(), resources.path(), "device", "now").unwrap();

        assert_eq!(summary.media_added, 6);
        assert_eq!(summary.themes_added, 2);
        assert_eq!(media::list(root.path()).unwrap().len(), 6);
        let saved_themes = themes::list(root.path()).unwrap();
        assert_eq!(saved_themes.len(), 2);
        let golden_cross = saved_themes
            .iter()
            .find(|theme| theme.id == "theme-stock-golden-cross")
            .unwrap();
        assert_eq!(
            golden_cross.use_as_default_for,
            vec!["songs", "scripture", "sermon"]
        );
    }

    #[test]
    fn running_twice_never_duplicates() {
        let root = tempfile::tempdir().unwrap();
        let local = tempfile::tempdir().unwrap();
        let resources = tempfile::tempdir().unwrap();
        write_resource_files(resources.path());

        import(root.path(), local.path(), resources.path(), "d", "now").unwrap();
        let second = import(root.path(), local.path(), resources.path(), "d", "now").unwrap();

        assert_eq!(second.media_added, 0);
        assert_eq!(second.themes_added, 0);
        assert_eq!(media::list(root.path()).unwrap().len(), 6);
        assert_eq!(themes::list(root.path()).unwrap().len(), 2);
    }

    #[test]
    fn does_not_steal_a_content_type_already_defaulted_by_an_existing_theme() {
        let root = tempfile::tempdir().unwrap();
        let local = tempfile::tempdir().unwrap();
        let resources = tempfile::tempdir().unwrap();
        write_resource_files(resources.path());
        themes::save(
            root.path(),
            theme_with_defaults("theme-church-own", &["songs"]),
            "d",
            "now",
        )
        .unwrap();

        import(root.path(), local.path(), resources.path(), "d", "now").unwrap();

        let golden_cross = themes::list(root.path())
            .unwrap()
            .into_iter()
            .find(|theme| theme.id == "theme-stock-golden-cross")
            .unwrap();
        assert_eq!(golden_cross.use_as_default_for, vec!["scripture", "sermon"]);
    }
}
