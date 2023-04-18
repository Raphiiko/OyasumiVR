use crate::IMAGE_CACHE;

#[tauri::command]
pub fn clean_image_cache(only_expired: bool) {
    IMAGE_CACHE
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .clean(only_expired);
}
