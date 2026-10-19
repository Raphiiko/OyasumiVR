//! UI copy for text the core draws itself, read from the same translation files as the UI.

use serde_json::Value;
use std::sync::{LazyLock, RwLock};
use tauri::AppHandle;

/// Embedded so lookups work in dev builds, which do not bundle the frontend assets.
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
pub fn set_ui_language(app: AppHandle, language: String) {
    let active = (language != "en")
        .then(|| {
            app.asset_resolver()
                .get(format!("assets/i18n/{language}.json"))
        })
        .flatten()
        .and_then(|asset| serde_json::from_slice(&asset.bytes).ok());
    let mut translations = TRANSLATIONS.write().unwrap();
    translations.language = language;
    translations.active = active;
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
