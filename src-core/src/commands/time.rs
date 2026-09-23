use chrono::{Local, TimeZone, Utc};
use serde::Deserialize;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Deserialize)]
struct IpLocation {
    lat: f64,
    lon: f64,
}

#[tauri::command]
pub async fn get_sunrise_sunset_time() -> Result<(String, String), String> {
    let location = locate_public_address().await?;
    // calculate today's events at the resolved coordinates
    let now = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(n) => n.as_millis() as i64,
        Err(_) => return Err("TIME_LOOKUP_FAILED".to_string()),
    };
    let sun_data = suncalc::get_times(suncalc::Timestamp(now), location.lat, location.lon, None);
    // return local schedule times only for nearby events
    let sunrise = local_hh_mm(sun_data.sunrise.0, now)
        .ok_or_else(|| "SOLAR_EVENT_UNAVAILABLE".to_string())?;
    let sunset =
        local_hh_mm(sun_data.sunset.0, now).ok_or_else(|| "SOLAR_EVENT_UNAVAILABLE".to_string())?;
    Ok((sunrise, sunset))
}

/// Without an address in the path, ip-api.com locates the address the request comes from, so the
/// request bypasses any system proxy.
async fn locate_public_address() -> Result<IpLocation, String> {
    let body = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|_| "LOCATION_LOOKUP_FAILED".to_string())?
        .get("http://ip-api.com/json/?fields=lat,lon")
        .send()
        .await
        .map_err(|_| "LOCATION_LOOKUP_FAILED".to_string())?
        .text()
        .await
        .map_err(|_| "LOCATION_LOOKUP_FAILED".to_string())?;
    serde_json::from_str(&body).map_err(|_| "LOCATION_PARSE_FAILED".to_string())
}

fn local_hh_mm(timestamp_ms: i64, now_ms: i64) -> Option<String> {
    if timestamp_ms.abs_diff(now_ms) > 48 * 3_600_000 {
        return None;
    }
    let utc = Utc.timestamp_millis_opt(timestamp_ms).single()?;
    Some(utc.with_timezone(&Local).format("%H:%M").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solar_times_require_a_nearby_valid_timestamp() {
        let now = 1_787_486_400_000;
        assert_eq!(local_hh_mm(0, now), None);
        for hours in [-48, -47, 0, 47, 48] {
            let timestamp = now + hours * 3_600_000;
            let expected = Utc
                .timestamp_millis_opt(timestamp)
                .unwrap()
                .with_timezone(&Local)
                .format("%H:%M")
                .to_string();
            assert_eq!(local_hh_mm(timestamp, now), Some(expected));
        }
        for timestamp in [
            now - 49 * 3_600_000,
            now + 49 * 3_600_000,
            i64::MIN,
            i64::MAX,
        ] {
            assert_eq!(local_hh_mm(timestamp, now), None);
        }
        assert_eq!(local_hh_mm(i64::MAX, i64::MAX), None);
    }
}
