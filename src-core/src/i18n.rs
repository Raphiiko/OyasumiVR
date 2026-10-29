//! UI copy for text the core draws itself, read from the same translation files as the UI.

use serde_json::Value;
use std::sync::{LazyLock, RwLock};
use tauri::AppHandle;

/// Embedded, so English text is there even when no translation file can be read.
const ENGLISH: &str = include_str!("../../src-ui/assets/i18n/en.json");

struct Translations {
    language: String,
    /// None when the language is English or its file could not be read.
    active: Option<Value>,
    english: Value,
}

static TRANSLATIONS: LazyLock<RwLock<Translations>> = LazyLock::new(|| {
    RwLock::new(Translations {
        language: "en".into(),
        active: None,
        english: serde_json::from_str(ENGLISH).unwrap_or(Value::Null),
    })
});

/// Mirrors the UI's language setting; `language` is an OyasumiVR locale code such as `ja`.
#[tauri::command]
#[specta::specta]
pub fn set_ui_language(app: AppHandle, language: String) {
    let active = (language != "en")
        .then(|| read_translations(&app, &language))
        .flatten()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    let mut translations = TRANSLATIONS.write().unwrap();
    translations.language = language;
    translations.active = active;
}

fn read_translations(app: &AppHandle, language: &str) -> Option<Vec<u8>> {
    let path = format!("assets/i18n/{language}.json");
    if tauri::is_dev() {
        // dev builds embed no frontend assets, so read the file from the source tree
        let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src-ui");
        return std::fs::read(source.join(path)).ok();
    }
    app.asset_resolver().get(path).map(|asset| asset.bytes)
}

pub fn language() -> String {
    TRANSLATIONS.read().unwrap().language.clone()
}

/// Looks up a dot separated key, as the UI writes them. Falls back to English, then to the key.
pub fn translate(key: &str) -> String {
    let translations = TRANSLATIONS.read().unwrap();
    let text = translations
        .active
        .iter()
        .chain([&translations.english])
        .find_map(|root| lookup(root, key))
        .map_or_else(|| key.to_string(), str::to_string);
    text
}

fn lookup<'a>(root: &'a Value, key: &str) -> Option<&'a str> {
    key.split('.')
        .try_fold(root, |value, part| value.get(part))?
        .as_str()
        .filter(|text| !text.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn looks_up_nested_keys_in_the_embedded_english_file() {
        assert_eq!(
            translate("steamvr-dashboard.desktopNotice.button"),
            "Show it here"
        );
        assert_eq!(
            translate("steamvr-dashboard.missing"),
            "steamvr-dashboard.missing"
        );
    }
}
