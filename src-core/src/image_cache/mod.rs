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
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

pub async fn init(cache_dir: PathBuf) {
    let image_cache_dir = cache_dir.join("image_cache");
    let image_cache = ImageCache::new(image_cache_dir.into_os_string());
    if let Err(error) = image_cache.clean(true) {
        error!("[Core] Image cache startup cleanup was incomplete: {error}");
    }
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

    fn store_image(&self, url: &str, ttl: u64, mime: Mime, image_data: &[u8]) {
        let _write_guard = self
            .write_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        // resolve the image and manifest paths
        let url_hash = format!("{:x}", md5::compute(url));
        let storage_path = Path::new(&self.cache_path_str).join(&url_hash);
        let manifest_path = storage_path.join("manifest.json");
        let file_ext = self.get_ext_for_mime(mime.clone());
        let file_name = format!("image.{file_ext}");
        let image_path = storage_path.join(&file_name);
        if storage_path.exists() {
            std::fs::remove_dir_all(&storage_path).unwrap();
        }
        std::fs::create_dir_all(&storage_path).unwrap();
        std::fs::write(image_path, image_data).unwrap();
        // publish the manifest after writing the image
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

    pub fn clean(&self, only_expired: bool) -> std::io::Result<()> {
        let _write_guard = self
            .write_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        // prepare the cache directory
        let cache_path = Path::new(&self.cache_path_str);
        if !cache_path.exists() {
            return std::fs::create_dir_all(cache_path);
        }
        let mut deleted = 0;
        let mut first_error = None;
        // remove eligible entries while retaining deletion failures
        for entry in std::fs::read_dir(cache_path)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if only_expired {
                if let Some(manifest) = Self::read_manifest(&path.join("manifest.json")) {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs();
                    if now
                        .checked_sub(manifest.created)
                        .is_some_and(|age| age < manifest.ttl)
                    {
                        continue;
                    }
                }
            }
            match std::fs::remove_dir_all(&path) {
                Ok(()) => deleted += 1,
                Err(error) => {
                    error!(
                        "[Core] Could not delete image cache entry. {}: {error}",
                        path.display()
                    );
                    first_error.get_or_insert(error);
                }
            }
        }
        // report the completed deletions and any failure
        if deleted > 0 {
            info!("[Core] Deleted {deleted} image(s) from the cache.");
        }
        first_error.map_or(Ok(()), Err)
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

    pub async fn handle_request(
        &self,
        req: Request<Incoming>,
    ) -> Result<Response<ResBody>, Infallible> {
        // read the requested image and cache lifetime
        let params: HashMap<String, String> = req
            .uri()
            .query()
            .map(|v| {
                url::form_urlencoded::parse(v.as_bytes())
                    .into_owned()
                    .collect()
            })
            .unwrap_or_default();

        let url = match params.get("url") {
            Some(url) => decode(url).expect("UTF-8"),
            None => {
                return Ok(Response::builder()
                    .status(400)
                    .body("Missing 'url' query parameter".into())
                    .unwrap());
            }
        };
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
        // serve unexpired images from the local cache
        if let Some((image_data, image_mime)) = self.get_image(String::from(url.as_ref())) {
            return Ok(Response::builder()
                .status(200)
                .header(hyper::header::CONTENT_TYPE, image_mime.to_string())
                .body(image_data.into())
                .unwrap());
        }
        // download missing image bytes through the shared connection pool
        let (image_data, image_mime) = match HTTP_CLIENT
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
                        (bytes, content_type)
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
        self.store_image(url.as_ref(), ttl, image_mime.clone(), &image_data);
        Ok(Response::builder()
            .status(200)
            .header(hyper::header::CONTENT_TYPE, image_mime.to_string())
            .body(image_data.into())
            .unwrap())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn first_and_repeat_requests_return_the_same_content_type() {
        use hyper::server::conn::http1;
        use hyper::service::service_fn;
        use hyper_util::rt::TokioIo;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        // serve one upstream image, then require cache hits
        let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let image_url = format!("http://{}/image.png", upstream.local_addr().unwrap());
        let upstream_task = tokio::spawn(async move {
            let (mut socket, _) = upstream.accept().await.unwrap();
            let mut request = [0; 2048];
            socket.read(&mut request).await.unwrap();
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\nConnection: close\r\n\r\nPNG")
                .await
                .unwrap();
        });

        // route both HTTP requests through the real handler
        let directory = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(directory.path().as_os_str().to_owned());
        let server = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!(
            "http://{}/?ttl=60&url={}",
            server.local_addr().unwrap(),
            urlencoding::encode(&image_url)
        );
        let server_task = tokio::spawn(async move {
            for _ in 0..2 {
                let (socket, _) = server.accept().await.unwrap();
                http1::Builder::new()
                    .keep_alive(false)
                    .serve_connection(
                        TokioIo::new(socket),
                        service_fn(|req| cache.handle_request(req)),
                    )
                    .await
                    .unwrap();
            }
        });

        // compare the miss and hit after upstream shutdown
        let first = reqwest::get(&url).await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), upstream_task)
            .await
            .unwrap()
            .unwrap();
        let repeat = reqwest::get(&url).await.unwrap();
        assert_eq!(first.status(), 200);
        assert_eq!(repeat.status(), 200);
        assert_eq!(first.headers()[hyper::header::CONTENT_TYPE], "image/png");
        assert_eq!(
            first.headers()[hyper::header::CONTENT_TYPE],
            repeat.headers()[hyper::header::CONTENT_TYPE]
        );
        assert_eq!(first.bytes().await.unwrap(), repeat.bytes().await.unwrap());
        server_task.await.unwrap();
    }

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
    fn full_clear_removes_entries_without_valid_expiration_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(directory.path().as_os_str().to_owned());
        for (name, contents) in [
            ("missing-fields", b"{}".as_slice()),
            ("invalid-types", br#"{"ttl":"60","created":false}"#),
            ("invalid-json", b"{"),
        ] {
            let entry = directory.path().join(name);
            std::fs::create_dir(&entry).unwrap();
            std::fs::write(entry.join("manifest.json"), contents).unwrap();
        }
        std::fs::create_dir_all(directory.path().join("unreadable/manifest.json")).unwrap();
        cache.store_image("fresh", u64::MAX, mime::IMAGE_PNG, &[1]);
        cache.store_image("expired", 0, mime::IMAGE_PNG, &[2]);

        cache.clean(false).unwrap();

        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[test]
    fn expiration_cleanup_preserves_fresh_entries() {
        let directory = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(directory.path().as_os_str().to_owned());
        cache.store_image("fresh", u64::MAX, mime::IMAGE_PNG, &[1]);
        cache.store_image("expired", 0, mime::IMAGE_PNG, &[2]);

        cache.clean(true).unwrap();

        assert!(cache.get_image("fresh".into()).is_some());
        assert!(!directory
            .path()
            .join(format!("{:x}", md5::compute("expired")))
            .exists());
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn full_clear_reports_locked_entries_and_retries() {
        use std::os::windows::fs::OpenOptionsExt;

        let directory = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(directory.path().as_os_str().to_owned());
        let entry = directory.path().join("locked");
        std::fs::create_dir(&entry).unwrap();
        let image = entry.join("image.png");
        std::fs::write(&image, [1]).unwrap();
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(image)
            .unwrap();
        cache.store_image("other", u64::MAX, mime::IMAGE_PNG, &[2]);

        assert!(cache.clean(false).is_err());
        assert!(entry.exists());
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);

        drop(lock);
        cache.clean(false).unwrap();
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[test]
    fn stored_manifest_is_published_and_readable() {
        let directory = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(directory.path().as_os_str().to_owned());
        let url = "https://example.com/image.png";
        let image = vec![1, 2, 3];

        cache.store_image(url, 60, mime::IMAGE_PNG, &image);

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

        cache.store_image(url, 60, mime::IMAGE_PNG, &[1, 2, 3]);

        let entry_path = directory.path().join(format!("{:x}", md5::compute(url)));
        let manifest_path = entry_path.join("manifest.json");
        let mut manifest = ImageCache::read_manifest(&manifest_path).unwrap();
        manifest.created = u64::MAX;
        std::fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();

        assert!(cache.get_image(url.to_string()).is_none());
        cache.clean(true).unwrap();
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
                        cache.store_image(url, 60, mime::IMAGE_PNG, &image);
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

        assert!(cache.clean(true).is_err());
        assert!(entry_path.exists());

        drop(locked_manifest);
        cache.clean(true).unwrap();
        assert!(!entry_path.exists());
    }
}
