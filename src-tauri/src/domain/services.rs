use std::fs;
use std::path::{Path, PathBuf};

use crate::models::{
    DisplayMode, LibrarySettings, RoleAssignment, SermonPassage, Service, ServiceItem,
    ServiceItemContent, ServiceTemplateItemKind,
};

use super::{delete_file_if_exists, read_json_dir, read_json_file, write_json_file};

fn services_root(root: &Path) -> PathBuf {
    root.join("services")
}

fn year_of(date: &str) -> &str {
    // Dates are stored as YYYY-MM-DD; falls back to a catch-all bucket for anything malformed
    // rather than failing the save outright.
    if date.len() >= 4 {
        &date[0..4]
    } else {
        "unknown"
    }
}

fn service_path(root: &Path, year: &str, id: &str) -> PathBuf {
    services_root(root).join(year).join(format!("{id}.json"))
}

pub fn list(root: &Path) -> std::io::Result<Vec<Service>> {
    let base = services_root(root);
    let mut services = Vec::new();
    if !base.exists() {
        return Ok(services);
    }
    for entry in fs::read_dir(&base)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            services.extend(read_json_dir::<Service>(&entry.path())?);
        }
    }
    Ok(services)
}

pub fn get(root: &Path, id: &str) -> std::io::Result<Option<Service>> {
    Ok(list(root)?.into_iter().find(|s| s.id == id))
}

/// Removes any existing file for this id across all year folders — needed so changing a
/// service's date (which changes which year folder it belongs in) doesn't leave a stale
/// orphaned copy behind in the old folder.
fn remove_existing_except(root: &Path, id: &str, keep: Option<&Path>) -> std::io::Result<()> {
    let base = services_root(root);
    if !base.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&base)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            let candidate = entry.path().join(format!("{id}.json"));
            if keep.is_none_or(|keep| candidate != keep) {
                delete_file_if_exists(&candidate)?;
            }
        }
    }
    Ok(())
}

pub fn save(
    root: &Path,
    mut service: Service,
    device: &str,
    now: &str,
) -> std::io::Result<Service> {
    service.updated_at = now.to_string();
    service.updated_by_device = device.to_string();
    let year = year_of(&service.date).to_string();
    let destination = service_path(root, &year, &service.id);
    // Commit the new version before removing a copy from an old year folder. If the write
    // fails, the previous service remains intact and visible.
    write_json_file(&destination, &service)?;
    remove_existing_except(root, &service.id, Some(&destination))?;
    Ok(service)
}

pub fn delete(root: &Path, id: &str) -> std::io::Result<()> {
    remove_existing_except(root, id, None)
}

pub fn list_upcoming(root: &Path, from_date: &str, to_date: &str) -> std::io::Result<Vec<Service>> {
    Ok(list(root)?
        .into_iter()
        .filter(|s| s.date.as_str() >= from_date && s.date.as_str() <= to_date)
        .collect())
}

/// One-time backfill for services saved before the sermon `ServiceItem` became the sole source
/// of truth for a service's sermon title/passage/preacher — those used to live only in
/// `Service`'s now-removed `sermonTitle`/`keyPassage`/`preacherId` fields. Since the typed
/// `Service` struct no longer declares them, an ordinary deserialize silently drops them (as it
/// already silently drops any unknown JSON field) — this is the only way to still recover them,
/// by re-parsing each file's raw bytes as a `serde_json::Value` alongside the normal typed read.
/// Idempotent and cheap on repeat runs: once a file has been migrated, `save()` has already
/// rewritten it through the (legacy-field-free) typed struct, so the raw parse finds nothing and
/// the file is skipped entirely — no separate "already migrated" flag is needed.
pub fn migrate_legacy_sermon_fields(root: &Path, device: &str, now: &str) -> std::io::Result<()> {
    let library_settings: Option<LibrarySettings> =
        read_json_file(&root.join("library-settings.json"))?;
    // ServiceTemplate::service_type is still name-based (see its own doc comment — not this
    // migration's concern), but Service::service_type_id is now an id; resolved once here so
    // the two can still be compared by name below.
    let service_type_names: std::collections::HashMap<String, String> =
        crate::domain::service_types::list(root)
            .unwrap_or_default()
            .into_iter()
            .map(|t| (t.id, t.name))
            .collect();

    for service in list(root)? {
        let year = year_of(&service.date).to_string();
        let path = service_path(root, &year, &service.id);
        let Some(raw) = read_json_file::<serde_json::Value>(&path)? else {
            continue;
        };
        let legacy_title = raw
            .get("sermonTitle")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let legacy_passage = raw
            .get("keyPassage")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let legacy_preacher_id = raw
            .get("preacherId")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        if legacy_title.is_none() && legacy_passage.is_none() && legacy_preacher_id.is_none() {
            continue;
        }

        // Falls back to the still-raw legacy `type` key when this service hasn't been through
        // commands::service_types's own migration yet — this function's caller makes no
        // guarantee about which of the two independent one-time migrations runs first.
        let service_type_name = if service.service_type_id.is_empty() {
            raw.get("type").and_then(|v| v.as_str()).map(str::to_string)
        } else {
            service_type_names.get(&service.service_type_id).cloned()
        };
        let mut service = service;
        if apply_legacy_sermon_fields(
            &mut service,
            legacy_title,
            legacy_passage,
            legacy_preacher_id,
            library_settings.as_ref(),
            service_type_name.as_deref(),
        ) {
            save(root, service, device, now)?;
        }
    }
    Ok(())
}

/// Folds recovered legacy sermon fields into a real sermon `ServiceItem` (see
/// `migrate_legacy_sermon_fields`'s doc comment for why they need recovering at all). Returns
/// whether anything actually changed, so the caller only rewrites files that needed it.
fn apply_legacy_sermon_fields(
    service: &mut Service,
    legacy_title: Option<String>,
    legacy_passage: Option<String>,
    legacy_preacher_id: Option<String>,
    library_settings: Option<&LibrarySettings>,
    service_type_name: Option<&str>,
) -> bool {
    let mut changed = false;

    // Prefer an existing sermon item; else a still-unfilled sermon placeholder to replace in
    // place (mirroring the frontend's own insertItem/beginReplacePlaceholder logic — its
    // role/bulletinLabel, if the church's ServiceTemplate set any, are untouched since only
    // `.content` is swapped); else synthesize a brand new one appended at the end.
    let sermon_index = service
        .items
        .iter()
        .position(|i| matches!(i.content, ServiceItemContent::Sermon { .. }));
    let target_index = sermon_index.or_else(|| {
        service.items.iter().position(|i| {
            matches!(&i.content, ServiceItemContent::Placeholder { suggested_tab, .. }
                if suggested_tab.as_deref() == Some("sermon"))
        })
    });

    let blank_sermon = || ServiceItemContent::Sermon {
        title: None,
        passages: vec![],
        main_passage_id: String::new(),
        outline: vec![],
        present_main_passage: Some(true),
        flow: vec![],
    };

    let index = match target_index {
        Some(i) => i,
        None => {
            service.items.push(ServiceItem {
                theme_id: None,
                id: format!("sermon-migrated-{}", service.id),
                content: blank_sermon(),
                role_id: None,
                bulletin_label: None,
                bulletin_note: None,
                auto_advance: None,
            });
            changed = true;
            service.items.len() - 1
        }
    };
    if sermon_index.is_none()
        && matches!(
            service.items[index].content,
            ServiceItemContent::Placeholder { .. }
        )
    {
        service.items[index].content = blank_sermon();
        changed = true;
    }

    let ServiceItemContent::Sermon {
        title,
        passages,
        main_passage_id,
        ..
    } = &mut service.items[index].content
    else {
        unreachable!("index always refers to a sermon item by this point")
    };

    if title.is_none() {
        if let Some(legacy_title) = legacy_title {
            *title = Some(legacy_title);
            changed = true;
        }
    }

    if passages.is_empty() {
        if let Some(reference) = legacy_passage {
            let translation = library_settings
                .and_then(|s| s.default_translation_code.clone())
                .unwrap_or_else(|| "KJV".to_string());
            let passage_id = format!("passage-migrated-{}", service.id);
            passages.push(SermonPassage {
                id: passage_id.clone(),
                reference,
                translation,
                display_mode: DisplayMode::Full,
            });
            *main_passage_id = passage_id;
            changed = true;
        }
    }

    // Resolve a role id to attach the legacy preacher to: the item's own role if it already
    // has one, else whatever role the church's configured ServiceTemplate uses for this service
    // type's sermon row — never a fabricated default (a hardcoded "Preacher" role would be wrong
    // for churches whose actual configured role is named something else entirely, and could
    // create a stray assignment nothing else ever references).
    let role_id = service.items[index].role_id.clone().or_else(|| {
        library_settings
            .and_then(|s| {
                s.service_templates
                    .iter()
                    .find(|t| Some(t.service_type.as_str()) == service_type_name)
            })
            .and_then(|t| {
                t.items
                    .iter()
                    .find(|i| matches!(i.kind, ServiceTemplateItemKind::Sermon))
            })
            .and_then(|i| i.role_id.clone())
    });

    if let Some(role_id) = role_id {
        if service.items[index].role_id.is_none() {
            service.items[index].role_id = Some(role_id.clone());
            changed = true;
        }
        if let Some(person_id) = legacy_preacher_id {
            let assignments = service.assignments.get_or_insert_with(Vec::new);
            if let Some(existing) = assignments.iter_mut().find(|a| a.role_id == role_id) {
                if existing.person_id.is_none() {
                    existing.person_id = Some(person_id);
                    changed = true;
                }
                // else: already assigned to a different person — the sermon item/assignments
                // are the source of truth now, so the disagreeing legacy value is dropped rather
                // than guessed at.
            } else {
                assignments.push(RoleAssignment {
                    role_id,
                    person_id: Some(person_id),
                    tentative: false,
                });
                changed = true;
            }
        }
    }

    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, date: &str) -> Service {
        Service {
            id: id.to_string(),
            date: date.to_string(),
            time: None,
            service_type_id: "type-sunday-morning-worship".to_string(),
            planning_notes: None,
            planning_song_ids: None,
            service_template_name: None,
            items: vec![],
            presenter_notes: None,
            assignments: None,
            bulletin_page1_footer: None,
            bulletin_page2_footer: None,
            updated_at: String::new(),
            updated_by_device: String::new(),
        }
    }

    #[test]
    fn save_places_service_under_its_year_folder() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("svc-1", "2026-07-19"), "d", "now").unwrap();
        assert!(dir.path().join("services/2026/svc-1.json").exists());
    }

    #[test]
    fn get_finds_a_service_without_knowing_its_year_upfront() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("svc-1", "2026-07-19"), "d", "now").unwrap();
        assert_eq!(
            get(dir.path(), "svc-1").unwrap().unwrap().date,
            "2026-07-19"
        );
    }

    #[test]
    fn changing_the_date_moves_the_file_to_the_new_year_folder() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("svc-1", "2026-07-19"), "d", "now").unwrap();
        save(dir.path(), sample("svc-1", "2027-01-05"), "d", "now").unwrap();

        assert!(!dir.path().join("services/2026/svc-1.json").exists());
        assert!(dir.path().join("services/2027/svc-1.json").exists());
        assert_eq!(list(dir.path()).unwrap().len(), 1);
    }

    #[test]
    fn list_upcoming_filters_by_inclusive_date_range() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), sample("svc-1", "2026-07-12"), "d", "now").unwrap();
        save(dir.path(), sample("svc-2", "2026-07-19"), "d", "now").unwrap();
        save(dir.path(), sample("svc-3", "2026-08-01"), "d", "now").unwrap();

        let upcoming = list_upcoming(dir.path(), "2026-07-19", "2026-07-31").unwrap();
        assert_eq!(upcoming.len(), 1);
        assert_eq!(upcoming[0].id, "svc-2");
    }

    // Writes a raw pre-migration service file directly (bypassing the typed `Service` struct,
    // which no longer has fields for the legacy sermonTitle/keyPassage/preacherId keys these
    // tests need to simulate) — `extra` merges in whatever legacy/items/assignments fields a
    // given test cares about.
    fn write_legacy_json(dir: &Path, id: &str, date: &str, extra: serde_json::Value) {
        let mut obj = serde_json::json!({
            "id": id,
            "date": date,
            "type": "Sunday Morning Worship",
            "items": [],
            "updatedAt": "original",
            "updatedByDevice": "original-device",
        });
        if let (Some(obj_map), Some(extra_map)) = (obj.as_object_mut(), extra.as_object()) {
            for (key, value) in extra_map {
                obj_map.insert(key.clone(), value.clone());
            }
        }
        let year = &date[0..4];
        let path = dir.join("services").join(year).join(format!("{id}.json"));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, serde_json::to_vec_pretty(&obj).unwrap()).unwrap();
    }

    #[test]
    fn migration_replaces_a_still_unfilled_sermon_placeholder_in_place() {
        let dir = tempfile::tempdir().unwrap();
        write_legacy_json(
            dir.path(),
            "svc-1",
            "2026-07-19",
            serde_json::json!({
                "sermonTitle": "Grace Alone",
                "keyPassage": "Ephesians 2:8-9",
                "items": [{ "id": "item-1", "type": "placeholder", "label": "Sermon", "suggestedTab": "sermon" }],
            }),
        );

        migrate_legacy_sermon_fields(dir.path(), "d", "migrated-time").unwrap();

        let service = get(dir.path(), "svc-1").unwrap().unwrap();
        assert_eq!(
            service.items.len(),
            1,
            "placeholder should be replaced in place, not appended alongside"
        );
        let ServiceItemContent::Sermon {
            title,
            passages,
            main_passage_id,
            ..
        } = &service.items[0].content
        else {
            panic!("expected the placeholder to become a sermon item");
        };
        assert_eq!(title.as_deref(), Some("Grace Alone"));
        assert_eq!(passages.len(), 1);
        assert_eq!(passages[0].reference, "Ephesians 2:8-9");
        assert_eq!(&passages[0].id, main_passage_id);
    }

    #[test]
    fn migration_recovers_a_role_from_the_service_template_when_nothing_else_has_one() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("library-settings.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "serviceTypes": [],
                "collections": [],
                "serviceTemplates": [{
                    "serviceType": "Sunday Morning Worship",
                    "items": [{ "id": "t1", "kind": "sermon", "label": "Sermon", "roleId": "role-worship-through-the-word" }],
                }],
                "branding": { "churchName": "", "primaryColor": "#000", "secondaryColor": "#000" },
                "apiBibleTranslations": [],
                "mediaMaxSyncedFileSizeMb": 50,
                "scriptureMinFontSizePx": 28,
                "scriptureMaxFontSizePx": 72,
                "songMinFontSizePx": 16,
                "songMaxFontSizePx": 72,
                "slideHeaderFontSizePx": 24,
                "slideFooterFontSizePx": 24,
            }))
            .unwrap(),
        )
        .unwrap();
        // No existing sermon item or placeholder at all — the append path.
        write_legacy_json(
            dir.path(),
            "svc-1",
            "2026-07-19",
            serde_json::json!({ "sermonTitle": "Grace Alone", "preacherId": "person-1" }),
        );

        migrate_legacy_sermon_fields(dir.path(), "d", "migrated-time").unwrap();

        let service = get(dir.path(), "svc-1").unwrap().unwrap();
        assert_eq!(service.items.len(), 1);
        assert_eq!(
            service.items[0].role_id.as_deref(),
            Some("role-worship-through-the-word")
        );
        let assignments = service.assignments.unwrap();
        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].role_id, "role-worship-through-the-word");
        assert_eq!(assignments[0].person_id.as_deref(), Some("person-1"));
    }

    #[test]
    fn migration_leaves_a_differing_existing_assignment_alone() {
        let dir = tempfile::tempdir().unwrap();
        write_legacy_json(
            dir.path(),
            "svc-1",
            "2026-07-19",
            serde_json::json!({
                "preacherId": "person-legacy",
                "items": [{
                    "id": "item-1",
                    "type": "sermon",
                    "roleId": "role-worship-through-the-word",
                    "passages": [],
                    "mainPassageId": "",
                    "outline": [],
                }],
                "assignments": [{ "roleId": "role-worship-through-the-word", "personId": "person-already-assigned", "tentative": false }],
            }),
        );

        migrate_legacy_sermon_fields(dir.path(), "d", "migrated-time").unwrap();

        let service = get(dir.path(), "svc-1").unwrap().unwrap();
        let assignments = service.assignments.unwrap();
        assert_eq!(assignments.len(), 1);
        assert_eq!(
            assignments[0].person_id.as_deref(),
            Some("person-already-assigned"),
            "an already-assigned person should win over a disagreeing legacy preacherId"
        );
    }

    #[test]
    fn migration_is_a_no_op_on_a_second_run() {
        let dir = tempfile::tempdir().unwrap();
        write_legacy_json(
            dir.path(),
            "svc-1",
            "2026-07-19",
            serde_json::json!({ "sermonTitle": "Grace Alone" }),
        );

        migrate_legacy_sermon_fields(dir.path(), "d", "first-run-time").unwrap();
        migrate_legacy_sermon_fields(dir.path(), "d", "second-run-time").unwrap();

        let service = get(dir.path(), "svc-1").unwrap().unwrap();
        assert_eq!(
            service.updated_at, "first-run-time",
            "a second run should find nothing left to migrate and skip rewriting the file"
        );
    }
}
