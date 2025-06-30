pub mod commands;

use hyper::{Body, Request, Response};
use log::{error, info};
use mime::Mime;
use serde_json::json;
use std::{
    collections::HashMap,
    convert::Infallible,
    ffi::OsString,
    path::{Path, PathBuf},
    str::FromStr,
};
use std::sync::LazyLock;
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
}

impl ImageCache {
    pub fn new(cache_path_str: OsString) -> ImageCache {
        ImageCache { cache_path_str }
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
        // Read json from manifest
        let manifest = match std::fs::read_to_string(&manifest_path) {
            Ok(manifest) => manifest,
            Err(_) => {
                error!(
                    "[Core] Could not read JSON from manifest file. {}",
                    manifest_path.display()
                );
                return None;
            }
        };
        let manifest: serde_json::Value = serde_json::from_str(&manifest).unwrap();
        // Get filename from manifest
        let file_name = match manifest["filename"].as_str() {
            Some(file_name) => file_name,
            None => {
                error!(
                    "[Core] Could not get filename from manifest file. {}",
                    manifest_path.display()
                );
                return None;
            }
        };
        // Get image path
        let image_path = storage_path.join(file_name);
        // If image doesn't exist, return None
        if !image_path.exists() {
            return None;
        }
        // Check if image is expired
        let ttl = match manifest["ttl"].as_u64() {
            Some(ttl) => ttl,
            None => {
                error!(
                    "[Core] Could not get TTL from manifest file. {}",
                    manifest_path.display()
                );
                return None;
            }
        };
        let created = match manifest["created"].as_u64() {
            Some(created) => created,
            None => {
                error!(
                    "[Core] Could not get created timestamp from manifest file. {}",
                    manifest_path.display()
                );
                return None;
            }
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        if now - created > ttl {
            return None;
        }
        // Get mime type from manifest
        let mime = match manifest["mime"].as_str() {
            Some(mime) => match Mime::from_str(mime) {
                Ok(mime) => mime,
                Err(_) => {
                    error!(
                        "[Core] Could not parse MIME type from manifest file. {}",
                        manifest_path.display()
                    );
                    return None;
                }
            },
            None => {
                error!(
                    "[Core] Could not get MIME type from manifest file. {}",
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
        let manifest = json!({
            "url": url,
            "hash": url_hash,
            "ttl": ttl,
            "mime": mime.to_string(),
            "created": chrono::Utc::now().timestamp(),
            "filename": file_name,
        });
        std::fs::write(manifest_path, manifest.to_string()).unwrap();
    }

    pub fn clean(&self, only_expired: bool) {
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
            // Read manifest
            let manifest_path = path.join("manifest.json");
            let manifest = match std::fs::read_to_string(&manifest_path) {
                Ok(manifest) => manifest,
                Err(_) => {
                    error!(
                        "[Core] Could not read JSON from manifest file. {}",
                        manifest_path.display()
                    );
                    // Delete path if manifest could not be read
                    std::fs::remove_dir_all(&path).unwrap();
                    continue;
                }
            };
            let manifest: serde_json::Value = serde_json::from_str(&manifest).unwrap();
            // Check if image is expired
            let ttl = match manifest["ttl"].as_u64() {
                Some(ttl) => ttl,
                None => {
                    error!(
                        "[Core] Could not get TTL from manifest file. {}",
                        manifest_path.display()
                    );
                    continue;
                }
            };
            let created = match manifest["created"].as_u64() {
                Some(created) => created,
                None => {
                    error!(
                        "[Core] Could not get created timestamp from manifest file. {}",
                        manifest_path.display()
                    );
                    continue;
                }
            };
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            if only_expired && now - created < ttl {
                continue;
            }
            // Delete storage directory
            std::fs::remove_dir_all(&path).unwrap();
            deleted += 1;
        }
        if deleted > 0 {
            info!("[Core] Deleted {} image(s) from the cache.", deleted);
        }
    }

    fn get_ext_for_mime(&self, mime: Mime) -> String {
        match mime_guess::get_mime_extensions(&mime) {
            Some(exts) => exts[0].to_string(),
            None => "bin".to_string(),
        }
    }

    pub async fn handle_request(&self, req: Request<Body>) -> Result<Response<Body>, Infallible> {
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
