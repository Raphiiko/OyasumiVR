pub mod commands;

use crate::http::ResBody;
use hyper::{body::Incoming, Request, Response};
use log::{error, info};
use mime::Mime;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, LazyLock, Mutex as SyncMutex};
use std::{
    collections::HashMap,
    convert::Infallible,
    ffi::OsString,
    path::{Path, PathBuf},
    str::FromStr,
};
use tokio::sync::Mutex;
use urlencoding::decode;

pub static INSTANCE: LazyLock<Mutex<Option<ImageCache>>> = LazyLock::new(Default::default);

pub async fn init(cache_dir: PathBuf) {
    let image_cache_dir = cache_dir.join("image_cache");
    let image_cache = ImageCache::new(image_cache_dir.into_os_string());
    image_cache.clean(true);
    *INSTANCE.lock().await = Some(image_cache);
}

#[derive(Debug, Clone)]
pub struct ImageCache {
    cache_path_str: OsString,
    write_lock: Arc<SyncMutex<()>>,
}

#[derive(Deserialize, Serialize)]
struct ImageCacheManifest {
    url: String,
    hash: String,
    ttl: u64,
    mime: String,
    created: u64,
    filename: String,
}

impl ImageCache {
    pub fn new(cache_path_str: OsString) -> ImageCache {
        ImageCache {
            cache_path_str,
            write_lock: Default::default(),
        }
    }

    fn get_image(&self, url: String) -> Option<(Vec<u8>, Mime)> {
        // Determine paths
        let url_hash = format!("{:x}", md5::compute(url));
        let storage_path = Path::new(&self.cache_path_str).join(url_hash);
        let manifest_path = storage_path.join("manifest.json");
        // If storage directory or the manifest don't exist, return None
        if !storage_path.exists() || !manifest_path.exists() {
            return None;
        }
        let manifest = Self::read_manifest(&manifest_path)?;
        // Get image path
        let image_path = storage_path.join(&manifest.filename);
        // If image doesn't exist, return None
        if !image_path.exists() {
            return None;
        }
        // check expiration
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        if now.checked_sub(manifest.created)? > manifest.ttl {
            return None;
        }
        // Get mime type from manifest
        let mime = match Mime::from_str(&manifest.mime) {
            Ok(mime) => mime,
            Err(_) => {
                error!(
                    "[Core] Could not parse MIME type from manifest file. {}",
                    manifest_path.display()
                );
                return None;
            }
        };
        // Read image data
        let image_data = match std::fs::read(&image_path) {
            Ok(image_data) => image_data,
            Err(_) => {
                error!(
                    "[Core] Could not read image data from file. {}",
                    image_path.display()
                );
                return None;
            }
        };
        // Return image data and mime type
        Some((image_data, mime))
    }

    fn store_image(&self, url: &str, ttl: u64, mime: Mime, image_data: Vec<u8>) {
        let _write_guard = self
            .write_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        // Determine paths
        let url_hash = format!("{:x}", md5::compute(url));
        let storage_path = Path::new(&self.cache_path_str).join(&url_hash);
        let manifest_path = storage_path.join("manifest.json");
        let file_ext = self.get_ext_for_mime(mime.clone());
        let file_name = format!("image.{file_ext}");
        let image_path = storage_path.join(&file_name);
        // Delete current storage directory if it exists
        if storage_path.exists() {
            std::fs::remove_dir_all(&storage_path).unwrap();
        }
        // Create storage directory
        std::fs::create_dir_all(&storage_path).unwrap();
        // Store image
        std::fs::write(image_path, image_data).unwrap();
        // Store manifest
        let manifest = ImageCacheManifest {
            url: url.to_string(),
            hash: url_hash,
            ttl,
            mime: mime.to_string(),
            created: chrono::Utc::now().timestamp() as u64,
            filename: file_name,
        };
        let mut temporary_manifest = tempfile::NamedTempFile::new_in(storage_path).unwrap();
        serde_json::to_writer(&mut temporary_manifest, &manifest).unwrap();
        temporary_manifest.persist(manifest_path).unwrap();
    }

    pub fn clean(&self, only_expired: bool) {
        let _write_guard = self
            .write_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        // Create directory at cache_path if it doesn't exist
        let cache_path = Path::new(&self.cache_path_str);
        if !cache_path.exists() {
            std::fs::create_dir_all(cache_path).unwrap();
            return;
        }
        let mut deleted = 0;
        // Iterate over all directories in cache_path
        for entry in std::fs::read_dir(cache_path).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            // Skip if path is not a directory
            if !path.is_dir() {
                continue;
            }
            let manifest_path = path.join("manifest.json");
            let manifest = match Self::read_manifest(&manifest_path) {
                Some(manifest) => manifest,
                None => {
                    Self::remove_entry(&path);
                    continue;
                }
            };
            // check expiration
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            if only_expired
                && now
                    .checked_sub(manifest.created)
                    .is_some_and(|age| age < manifest.ttl)
            {
                continue;
            }
            // Delete storage directory
            if Self::remove_entry(&path) {
                deleted += 1;
            }
        }
        if deleted > 0 {
            info!("[Core] Deleted {deleted} image(s) from the cache.");
        }
    }

    fn get_ext_for_mime(&self, mime: Mime) -> String {
        match mime_guess::get_mime_extensions(&mime) {
            Some(exts) => exts[0].to_string(),
            None => "bin".to_string(),
        }
    }

    fn read_manifest(manifest_path: &Path) -> Option<ImageCacheManifest> {
        let result = std::fs::read(manifest_path)
            .ok()
            .and_then(|manifest| serde_json::from_slice(&manifest).ok());
        if result.is_none() {
            error!(
                "[Core] Could not read image cache manifest. {}",
                manifest_path.display()
            );
        }
        result
    }

    fn remove_entry(path: &Path) -> bool {
        if let Err(error) = std::fs::remove_dir_all(path) {
            error!(
                "[Core] Could not delete image cache entry. {}: {error}",
                path.display()
            );
            return false;
        }
        true
    }

    pub async fn handle_request(
        &self,
        req: Request<Incoming>,
    ) -> Result<Response<ResBody>, Infallible> {
        // Parse query parameters
        let params: HashMap<String, String> = req
            .uri()
            .query()
            .map(|v| {
                url::form_urlencoded::parse(v.as_bytes())
                    .into_owned()
                    .collect()
            })
            .unwrap_or_default();

        // Get URL parameter
        let url = match params.get("url") {
            Some(url) => decode(url).expect("UTF-8"),
            None => {
                return Ok(Response::builder()
                    .status(400)
                    .body("Missing 'url' query parameter".into())
                    .unwrap());
            }
        };
        // Get ttl parameter
        let ttl = match params.get("ttl") {
            Some(ttl) => match ttl.parse::<u64>() {
                Ok(ttl) => ttl,
                Err(_) => {
                    return Ok(Response::builder()
                        .status(400)
                        .body("Invalid 'ttl' query parameter".into())
                        .unwrap());
                }
            },
            None => {
                return Ok(Response::builder()
                    .status(400)
                    .body("Missing 'ttl' query parameter".into())
                    .unwrap());
            }
        };
        // Return cached data if present
        if let Some((image_data, image_mime)) = self.get_image(String::from(url.as_ref())) {
            return Ok(Response::builder()
                .status(200)
                .header(hyper::header::CONTENT_TYPE, image_mime.to_string())
                .body(image_data.into())
                .unwrap());
        }
        // Get image from URL
        let client = reqwest::Client::new();
        let (image_data, image_mime) = match client
            .get(url.as_ref())
            .header(
                reqwest::header::USER_AGENT,
                format!(
                    "OyasumiVR/{} (https://github.com/Raphiiko/OyasumiVR)",
                    env!("CARGO_PKG_VERSION"),
                ),
            )
            .send()
            .await
        {
            Ok(response) => {
                let headers = response.headers().clone();
                let bytes = response.bytes();
                match bytes.await {
                    Ok(bytes) => {
                        let content_type = match headers.get(reqwest::header::CONTENT_TYPE) {
                            None => {
                                return Ok(Response::builder()
                                    .status(500)
                                    .body("Failed to get image content type (1)".into())
                                    .unwrap());
                            }
                            Some(content_type) => {
                                let content_type_str = match content_type.to_str() {
                                    Ok(content_type_str) => content_type_str,
                                    Err(_) => {
                                        return Ok(Response::builder()
                                            .status(500)
                                            .body("Failed to get image content type (2)".into())
                                            .unwrap());
                                    }
                                };
                                match Mime::from_str(content_type_str) {
                                    Ok(content_type) => content_type,
                                    Err(_) => {
                                        return Ok(Response::builder()
                                            .status(500)
                                            .body("Failed to get image content type (3)".into())
                                            .unwrap());
                                    }
                                }
                            }
                        };
                        (bytes.to_vec(), content_type)
                    }
                    Err(_) => {
                        return Ok(Response::builder()
                            .status(500)
                            .body("Failed to get image data".into())
                            .unwrap());
                    }
                }
            }
            Err(_) => {
                return Ok(Response::builder()
                    .status(500)
                    .body("Failed to get image".into())
                    .unwrap());
            }
        };
        // Cache image
        self.store_image(url.as_ref(), ttl, image_mime, image_data.clone());
        // Return image
        Ok(Response::builder()
            .status(200)
            .body(image_data.into())
            .unwrap())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn corrupted_manifests_are_removed_and_miss_on_read() {
        for contents in [b"{".as_slice(), &[0xff, 0xfe], b"{}"] {
            let directory = tempfile::tempdir().unwrap();
            let cache_path = directory.path().join("image_cache");
            let url = "https://example.com/image.png";
            let entry_path = cache_path.join(format!("{:x}", md5::compute(url)));
            std::fs::create_dir_all(&entry_path).unwrap();
            std::fs::write(entry_path.join("manifest.json"), contents).unwrap();

            let cache = ImageCache::new(cache_path.clone().into_os_string());
            assert!(cache.get_image(url.to_string()).is_none());

            init(directory.path().to_path_buf()).await;
            assert!(!entry_path.exists());
        }
    }

    #[test]
    fn stored_manifest_is_published_and_readable() {
        let directory = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(directory.path().as_os_str().to_owned());
        let url = "https://example.com/image.png";
        let image = vec![1, 2, 3];

        cache.store_image(url, 60, mime::IMAGE_PNG, image.clone());

        let entry_path = directory.path().join(format!("{:x}", md5::compute(url)));
        assert!(entry_path.join("manifest.json").exists());
        assert_eq!(cache.get_image(url.to_string()).unwrap().0, image);
        assert_eq!(std::fs::read_dir(entry_path).unwrap().count(), 2);
    }

    #[test]
    fn future_dated_manifests_miss_and_are_removed() {
        let directory = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(directory.path().as_os_str().to_owned());
        let url = "https://example.com/image.png";

        cache.store_image(url, 60, mime::IMAGE_PNG, vec![1, 2, 3]);

        let entry_path = directory.path().join(format!("{:x}", md5::compute(url)));
        let manifest_path = entry_path.join("manifest.json");
        let mut manifest = ImageCache::read_manifest(&manifest_path).unwrap();
        manifest.created = u64::MAX;
        std::fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();

        assert!(cache.get_image(url.to_string()).is_none());
        cache.clean(true);
        assert!(!entry_path.exists());
    }

    #[test]
    fn concurrent_writes_publish_a_readable_entry() {
        let directory = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(directory.path().as_os_str().to_owned());
        let url = "https://example.com/image.png";

        std::thread::scope(|scope| {
            for image in [vec![1, 2, 3], vec![4, 5, 6]] {
                let cache = cache.clone();
                scope.spawn(move || {
                    for _ in 0..16 {
                        cache.store_image(url, 60, mime::IMAGE_PNG, image.clone());
                    }
                });
            }
        });

        let entry_path = directory.path().join(format!("{:x}", md5::compute(url)));
        assert!(cache.get_image(url.to_string()).is_some());
        assert_eq!(std::fs::read_dir(entry_path).unwrap().count(), 2);
    }

    #[cfg(windows)]
    #[test]
    fn cleanup_continues_when_a_corrupt_entry_is_locked() {
        use std::os::windows::fs::OpenOptionsExt;

        let directory = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(directory.path().as_os_str().to_owned());
        let entry_path = directory.path().join("entry");
        let manifest_path = entry_path.join("manifest.json");
        std::fs::create_dir_all(&entry_path).unwrap();
        std::fs::write(&manifest_path, b"{").unwrap();
        let locked_manifest = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(manifest_path)
            .unwrap();

        cache.clean(true);
        assert!(entry_path.exists());

        drop(locked_manifest);
        cache.clean(true);
        assert!(!entry_path.exists());
    }
}
